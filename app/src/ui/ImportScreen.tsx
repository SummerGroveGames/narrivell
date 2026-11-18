import { type DragEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import type { Book, TreeNode } from '../core/structure';
import { numberTree, unitsInOrder } from '../core/structure';
import { analyse, type Analysis, assignLevels, type Break, build, type FormatMode } from '../import/breaks';
import { readDocx, type Run } from '../import/docx';
import { countWords, plainText } from '../project/doc';
import type { ProjectStore } from '../project/store';
import { isDesktop } from '../pwa';
import { pickImportFile } from '../storage/native';

interface Props {
  store: ProjectStore;
  onCancel: () => void;
  /** Called after import with the first new unit and the new word counts. */
  onDone: (firstUnitId: string | null, words: Map<string, number>) => void;
  onError: (message: string) => void;
}

const MODES: { id: FormatMode; label: string; hint: string }[] = [
  { id: 'emphasis', label: 'Keep emphasis', hint: 'Italic and bold kept; fonts, colours and sizes dropped' },
  { id: 'all', label: 'Keep all', hint: 'Also underline and strikethrough' },
  { id: 'plain', label: 'Plain text', hint: 'Just the words' },
];

const CONFIDENCE_STYLE: Record<string, string> = {
  certain: 'import-break--certain',
  likely: 'import-break--likely',
  possible: 'import-break--possible',
};

function RunsText({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((r, i) => {
        const pieces = r.text.split('\n');
        let node: ReactNode = pieces.map((piece, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {piece}
          </span>
        ));
        if (r.italic) node = <i>{node}</i>;
        if (r.bold) node = <b>{node}</b>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

export function ImportScreen({ store, onCancel, onDone, onError }: Props) {
  const levels = store.project.settings.levels;
  const unitIdx = levels.length - 1;
  const [fileName, setFileName] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [breaks, setBreaks] = useState<Break[]>([]);
  const [mode, setMode] = useState<FormatMode>('emphasis');
  const [renameTop, setRenameTop] = useState(true);
  const [busy, setBusy] = useState('');
  const [dragging, setDragging] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (bytes: Uint8Array, name: string) => {
    setBusy('Reading your document…');
    try {
      const paragraphs = await readDocx(bytes);
      const a = analyse(paragraphs);
      if (!a.blocks.length) throw new Error('That document has no text in it.');
      setAnalysis(a);
      setBreaks(assignLevels(a.breaks, levels));
      setFileName(name);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy('');
    }
  };

  const choose = async () => {
    if (isDesktop) {
      try {
        const bytes = await pickImportFile();
        if (bytes) await load(bytes, 'Word document');
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } else fileInput.current?.click();
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) return onError('Only Word .docx files can be imported for now.');
    await load(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  // --- preview ---------------------------------------------------------------
  const preview = useMemo(() => {
    if (!analysis) return null;
    let n = 0;
    const result = build(analysis.blocks, breaks, levels, mode, () => `preview-${n++}`);
    const book: Book = { structure: { levels }, children: [...store.project.tree, ...result.nodes] };
    const numbers = numberTree(book);
    const words = new Map<string, number>();
    for (const [id, doc] of result.docs) words.set(id, countWords(plainText(doc)));
    return { ...result, numbers, words };
  }, [analysis, breaks, mode, levels, store]);

  const breakAt = useMemo(() => new Map(breaks.map((b, i) => [b.at, i])), [breaks]);
  const word = breaks.find((b) => b.role === 'top' && b.word)?.word ?? null;
  const offerRename = !!word && levels.length >= 2 && levels[0].name !== word;

  const setBreak = (i: number, change: Partial<Break>) => setBreaks((bs) => bs.map((b, j) => (j === i ? { ...b, ...change } : b)));
  const addBreak = (at: number) =>
    setBreaks((bs) =>
      [...bs, { at, role: 'scene', level: unitIdx, title: '', unnumbered: false, confidence: 'certain', reason: 'Added by you', fileNumber: null, word: null } as Break].sort(
        (a, b) => a.at - b.at,
      ),
    );

  const target = store.project.settings.unitTarget;
  const wordsIn = (node: TreeNode): number =>
    node.kind === 'unit' ? (preview?.words.get(node.id) ?? 0) : node.children.reduce((s, c) => s + wordsIn(c), 0);

  const mismatches = breaks.filter((b) => {
    if (b.level === null || b.fileNumber === null || !preview) return false;
    for (const [id, start] of preview.starts) {
      if (start === b.at) return preview.numbers.get(id)?.number !== String(b.fileNumber);
    }
    return false;
  }).length;

  const jump = (block: number) =>
    textRef.current?.querySelector(`[data-block="${block}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  const doImport = async () => {
    if (!analysis) return;
    setBusy('Importing…');
    try {
      if (offerRename && renameTop) levels[0].name = word!;
      const result = build(analysis.blocks, breaks, levels, mode);
      const book = store.book;
      // A brand-new project starts with one empty place to write; replace it rather than keep it.
      const existing = unitsInOrder(book);
      if (existing.length === 1) {
        const only = existing[0].unit;
        const text = plainText(await store.loadUnit(only.id)).trim();
        if (!text) {
          const top = existing[0].path[0] ?? only;
          book.children.splice(book.children.indexOf(top), 1);
          store.project.trash.push(top);
        }
      }
      book.children.push(...result.nodes);
      let done = 0;
      const words = new Map<string, number>();
      for (const [id, doc] of result.docs) {
        await store.saveUnit(id, doc);
        words.set(id, countWords(plainText(doc)));
        if (++done % 10 === 0) setBusy(`Importing… ${done} of ${result.docs.size}`);
      }
      await store.saveProject();
      const first = unitsInOrder({ structure: book.structure, children: result.nodes })[0]?.unit.id ?? null;
      onDone(first, words);
    } catch (e) {
      onError(`Import stopped: ${e instanceof Error ? e.message : String(e)}. Nothing already in your book was changed.`);
      setBusy('');
    }
  };

  // --- choose a file -----------------------------------------------------------
  if (!analysis) {
    return (
      <div className="import">
        <div
          className={`import-drop ${dragging ? 'import-drop--over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <h2>Import a Word document</h2>
          <p className="muted">
            Drop a .docx file here, or choose one. Narrivell finds your sections, chapters and scene breaks and
            shows them to you before anything is added to the book. Your Word file is never changed.
          </p>
          <div className="row">
            <button type="button" className="button" onClick={choose} disabled={!!busy}>
              Choose a Word file…
            </button>
            <button type="button" className="button button--quiet" onClick={onCancel} disabled={!!busy}>
              Cancel
            </button>
          </div>
          {busy && <p className="muted small">{busy}</p>}
          <input
            ref={fileInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) await load(new Uint8Array(await file.arrayBuffer()), file.name);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    );
  }

  // --- review breaks --------------------------------------------------------------
  const levelOptions = levels.map((l, i) => ({ i, name: i === 0 && offerRename && renameTop ? word! : l.name }));

  return (
    <div className="import import--review">
      <header className="import-head">
        <div>
          <div className="placeholder__kicker">Import · {fileName}</div>
          <h2>Check the breaks</h2>
          <p className="muted small">
            {analysis.stats.words.toLocaleString()} words · {breaks.filter((b) => b.level !== null).length} breaks kept
            · {analysis.stats.emptyRemoved.toLocaleString()} empty lines removed
            {analysis.stats.mergedHeadingsSplit > 0 && ` · ${analysis.stats.mergedHeadingsSplit} headings separated from the text after them`}
          </p>
        </div>
        <div className="seg" role="radiogroup" aria-label="Formatting">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'on' : ''} title={m.hint} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="row row--tight">
          <button type="button" className="button button--quiet" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
          <button type="button" className="button" onClick={doImport} disabled={!!busy}>
            {busy || 'Add to the book'}
          </button>
        </div>
      </header>

      <div className="import-body">
        <div className="import-text" ref={textRef}>
          {analysis.blocks.map((block, i) => {
            const bi = breakAt.get(i);
            const br = bi !== undefined ? breaks[bi] : null;
            const kept = br && br.level !== null;
            return (
              <div key={i} data-block={i} className="import-block">
                {br ? (
                  <div className={`import-break ${CONFIDENCE_STYLE[br.confidence]} ${kept ? '' : 'import-break--off'}`}>
                    <select
                      aria-label="Break type"
                      value={br.level ?? ''}
                      onChange={(e) => setBreak(bi!, { level: e.target.value === '' ? null : Number(e.target.value) })}
                    >
                      <option value="">No break</option>
                      {levelOptions.map((l) => (
                        <option key={l.i} value={l.i}>
                          {l.i === unitIdx ? `New ${l.name.toLowerCase()}` : l.name}
                        </option>
                      ))}
                    </select>
                    {kept && br.level! < unitIdx && (
                      <input
                        className="import-break__title"
                        value={br.title}
                        placeholder="Title (optional)"
                        aria-label="Title"
                        onChange={(e) => setBreak(bi!, { title: e.target.value })}
                      />
                    )}
                    {kept && br.role === 'special' && (
                      <label className="check">
                        <input type="checkbox" checked={br.unnumbered} onChange={(e) => setBreak(bi!, { unnumbered: e.target.checked })} />
                        No number
                      </label>
                    )}
                    <span className="import-break__why" title={br.reason}>
                      {br.confidence === 'possible' ? 'Maybe: ' : ''}
                      {br.reason}
                    </span>
                  </div>
                ) : (
                  block.kind === 'text' && (
                    <button type="button" className="import-add" onClick={() => addBreak(i)} title={`Start a new ${levels[unitIdx].name.toLowerCase()} here`}>
                      + {levels[unitIdx].name.toLowerCase()} break
                    </button>
                  )
                )}
                {block.kind === 'heading' && kept ? null : block.kind === 'scene' ? (
                  kept ? null : <p className="import-scene">⁂</p>
                ) : (
                  <p className={block.kind === 'heading' ? 'import-heading' : ''}>
                    {mode === 'plain' ? block.text : <RunsText runs={block.runs} />}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <aside className="import-outline" aria-label="What will be added">
          <h3>What will be added</h3>
          {offerRename && (
            <label className="check import-rename">
              <input type="checkbox" checked={renameTop} onChange={(e) => setRenameTop(e.target.checked)} />
              Call “{levels[0].name}” “{word}”, like your file does
            </label>
          )}
          {mismatches > 0 && (
            <p className="warning small">
              {mismatches} chapter number{mismatches === 1 ? '' : 's'} won’t match your file, because numbering continues from what’s already in
              the book. Import your files in order and they’ll line up.
            </p>
          )}
          <ul className="import-tree">
            {preview?.nodes.map(function render(node: TreeNode): ReactNode {
              const label = preview!.numbers.get(node.id)?.label ?? '';
              const w = wordsIn(node);
              const off = node.kind === 'unit' && target && (w < target.min || w > target.max);
              return (
                <li key={node.id}>
                  <button type="button" onClick={() => jump(preview!.starts.get(node.id) ?? 0)}>
                    <span className={node.kind === 'container' ? 'import-tree__container' : ''}>
                      {label && <span className="binder__num">{label}</span>} {node.title}
                    </span>
                    <span className={`binder__words ${off ? 'binder__words--off' : ''}`}>{w.toLocaleString()}</span>
                  </button>
                  {node.kind === 'container' && node.children.length > 0 && <ul>{node.children.map(render)}</ul>}
                </li>
              );
            })}
          </ul>
          {target && (
            <p className="muted small">
              Amber counts are outside your {target.min.toLocaleString()}–{target.max.toLocaleString()} word target. You can
              split chapters into microchapters here, or later with Microchapter assist.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
