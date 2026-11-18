import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { pageStyle } from '../appearance/appearance';
import type { AppearanceControls } from '../appearance/useAppearance';
import { type ContainerNode, numberTree, unitsInOrder } from '../core/structure';
import { isDesktop } from '../pwa';
import type { DocNode } from '../project/doc';
import { countWords, plainText } from '../project/doc';
import type { ProjectStore } from '../project/store';
import { addContainer, addUnit, displayLabel, findNode, firstUnit, moveNode, nudge, removeToTrash, rename } from '../project/tree';
import { AppearancePanel } from './AppearancePanel';
import { ImportScreen } from './ImportScreen';
import { Binder } from './Binder';
import { Editor } from './Editor';

interface Props {
  store: ProjectStore;
  look: AppearanceControls;
  focus: boolean;
  onFocusChange: (focus: boolean) => void;
  onClose: () => void;
  onError: (message: string) => void;
}

type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';
const SAVE_DELAY_MS = 700;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Workspace({ store, look, focus, onFocusChange, onClose, onError }: Props) {
  const book = store.book;
  const levels = store.project.settings.levels;
  const unitLevel = levels[levels.length - 1];
  const target = store.project.settings.unitTarget;

  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const [selectedId, setSelectedId] = useState<string | null>(() => firstUnit(store.project.tree)?.id ?? null);
  const [doc, setDoc] = useState<{ id: string; doc: DocNode } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [words, setWords] = useState<Map<string, number>>(new Map());
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // --- Saving --------------------------------------------------------------
  const pending = useRef<{ id: string; doc: DocNode } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setSaveState('saving');
    try {
      await store.saveUnit(job.id, job.doc);
      setSaveState(pending.current ? 'unsaved' : 'saved');
    } catch (e) {
      // Keep the text so the next attempt saves it.
      pending.current ??= job;
      setSaveState('failed');
      onError(`Couldn’t save: ${message(e)}. Your text is still on screen; Narrivell will keep trying.`);
      timer.current = window.setTimeout(() => void flush(), 5000);
    }
  }, [store, onError]);

  const onChange = useCallback(
    (id: string, next: DocNode) => {
      pending.current = { id, doc: next };
      setSaveState('unsaved');
      setWords((w) => new Map(w).set(id, countWords(plainText(next))));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const saveStructure = useCallback(async () => {
    refresh();
    try {
      await store.saveProject();
    } catch (e) {
      onError(`Couldn’t save the binder: ${message(e)}`);
    }
  }, [store, onError]);

  // Save when the window is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onHide);
    let unlisten: (() => void) | undefined;
    if (isDesktop) {
      import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) =>
          getCurrentWindow().onCloseRequested(async () => {
            await flush();
            await store.flush();
          }),
        )
        .then((u) => (unlisten = u))
        .catch(() => undefined);
    }
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onHide);
      unlisten?.();
      void flush();
    };
  }, [flush, store]);

  // --- Loading ---------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const counts = new Map<string, number>();
      for (const { unit } of unitsInOrder(book)) {
        try {
          counts.set(unit.id, countWords(plainText(await store.loadUnit(unit.id))));
        } catch {
          // A damaged unit shows its own message when opened.
        }
        if (cancelled) return;
      }
      setWords((w) => new Map([...counts, ...w]));
    })();
    return () => {
      cancelled = true;
    };
    // Counted once when the project opens; edits keep the counts up to date after that.
  }, [store]);

  useEffect(() => {
    setLoadError('');
    const node = selectedId ? findNode(book, selectedId) : null;
    if (!node || node.kind !== 'unit') return setDoc(null);
    let cancelled = false;
    flush()
      .then(() => store.loadUnit(node.id))
      .then((d) => !cancelled && setDoc({ id: node.id, doc: d }))
      .catch((e) => !cancelled && (setDoc(null), setLoadError(message(e))));
    return () => {
      cancelled = true;
    };
  }, [selectedId, store]);

  // --- Binder actions -----------------------------------------------------------
  const select = (id: string) => setSelectedId(id);

  const act = (fn: () => string | null | void) => {
    try {
      const nextSelected = fn();
      if (nextSelected) setSelectedId(nextSelected);
      void saveStructure();
    } catch (e) {
      onError(message(e));
    }
  };

  const selected = selectedId ? findNode(book, selectedId) : null;
  const totalWords = unitsInOrder(book).reduce((sum, { unit }) => sum + (words.get(unit.id) ?? 0), 0);
  const unitWords = selected?.kind === 'unit' ? (words.get(selected.id) ?? 0) : 0;
  const unitCount = unitsInOrder(book).length;

  const levelName = (levelId: string) => levels.find((l) => l.id === levelId)?.name ?? 'Section';
  const containerSummary = (c: ContainerNode) => {
    const units = unitsInOrder({ structure: book.structure, children: [c] });
    const count = units.reduce((sum, { unit }) => sum + (words.get(unit.id) ?? 0), 0);
    return `${units.length} ${unitLevel.name.toLowerCase()}${units.length === 1 ? '' : 's'}, ${count.toLocaleString()} words.`;
  };

  const moveToTrash = (id: string) => {
    const node = findNode(book, id);
    if (!node) return;
    const unitsInside = node.kind === 'unit' ? 1 : unitsInOrder({ structure: book.structure, children: [node] }).length;
    if (unitCount - unitsInside < 1) return onError('A book needs at least one place to write.');
    const what = displayLabel(book, node);
    if (!window.confirm(`Move “${what}” to the trash? Its text is kept and can be restored later.`)) return;
    act(() => {
      removeToTrash(book, store.project.trash, id);
      return firstUnit(book.children)?.id ?? null;
    });
  };

  const toggle = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const savedLabel = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', failed: 'Not saved – retrying' }[saveState];
  const a = look.appearance;

  const tools = (
    <>
      <button
        type="button"
        className={`tool ${appearanceOpen ? 'tool--on' : ''}`}
        data-appearance-toggle
        title="Appearance: font, page colour, layout, night light"
        aria-label="Appearance"
        aria-expanded={appearanceOpen}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAppearanceOpen((o) => !o)}
      >
        <span className="tool__aa">
          <small>A</small>A
        </span>
      </button>
      <button
        type="button"
        className={`tool ${focus ? 'tool--on' : ''}`}
        title={focus ? 'Leave focus mode (Esc)' : 'Focus mode (Ctrl+Shift+F)'}
        aria-label="Focus mode"
        aria-pressed={focus}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onFocusChange(!focus)}
      >
        ⛶
      </button>
    </>
  );

  return (
    <div className={`workspace ${focus ? 'workspace--focus' : ''}`}>
      <aside className="sidebar" aria-hidden={focus}>
        <div className="sidebar__head">
          <div className="sidebar__heading">
            <h2 className="sidebar__title" title={store.storage.label}>
              {store.project.title || 'Untitled'}
            </h2>
            {store.project.author && <span className="sidebar__author">{store.project.author}</span>}
          </div>
          <button
            type="button"
            className="link-button"
            onClick={async () => {
              await flush();
              await store.flush();
              onClose();
            }}
          >
            Close
          </button>
        </div>

        <div className="sidebar__actions">
          <button type="button" className="chip" onClick={() => act(() => addUnit(book, selectedId).id)}>
            + {unitLevel.name}
          </button>
          <button type="button" className="chip chip--quiet" onClick={() => void flush().then(() => setImporting(true))}>
            Import Word…
          </button>
          {levels.slice(0, -1).map((level) => (
            <button
              key={level.id}
              type="button"
              className="chip chip--quiet"
              onClick={() => act(() => addContainer(book, level, selectedId).unit.id)}
            >
              + {level.name}
            </button>
          ))}
        </div>

        <div className="sidebar__tree">
          <Binder
            book={book}
            selectedId={selectedId}
            words={words}
            collapsed={collapsed}
            target={target}
            onToggle={toggle}
            onSelect={select}
            onRename={(id, title) => act(() => rename(book, id, title))}
            onMove={(id, targetId, position) => {
              const problem = moveNode(book, id, targetId, position);
              if (problem) onError(problem);
              else void saveStructure();
            }}
            onAddAfter={(id) => act(() => addUnit(book, id).id)}
            onNudge={(id, direction) => act(() => void nudge(book, id, direction))}
            onTrash={moveToTrash}
          />
        </div>

        <footer className="sidebar__foot">
          <span>
            {totalWords.toLocaleString()} words · {unitCount} {unitLevel.name.toLowerCase()}
            {unitCount === 1 ? '' : 's'}
          </span>
        </footer>
      </aside>

      {importing ? (
        <section className="main main--import">
          <ImportScreen
            store={store}
            onCancel={() => setImporting(false)}
            onError={onError}
            onDone={(first, counts) => {
              setWords((w) => new Map([...w, ...counts]));
              setImporting(false);
              if (first) setSelectedId(first);
              refresh();
            }}
          />
        </section>
      ) : (
      <section
        className={`main ${a.grain ? 'main--grain' : ''} ${a.paragraphs === 'book' ? 'main--indent' : 'main--spaced'}`}
        style={pageStyle(a, look.systemDark) as CSSProperties}
      >
        {selected?.kind === 'unit' && doc?.id === selected.id ? (
          <>
            <header className="unit-head">
              <span className="unit-head__label">{numberTree(book).get(selected.id)?.label}</span>
              <input
                className="unit-head__title"
                placeholder={`${unitLevel.name} title (optional)`}
                value={selected.title}
                maxLength={500}
                onChange={(e) => {
                  rename(book, selected.id, e.target.value);
                  refresh();
                }}
                onBlur={() => void saveStructure()}
              />
            </header>
            <Editor
              key={doc.id}
              initial={doc.doc}
              typewriter={a.typewriter}
              tools={tools}
              onChange={(d) => onChange(doc.id, d)}
            />
          </>
        ) : selected?.kind === 'container' ? (
          <div className="placeholder">
            <p className="placeholder__kicker">{levelName(selected.levelId)}</p>
            <h2>{displayLabel(book, selected)}</h2>
            <p className="muted">
              {containerSummary(selected)} Select a {unitLevel.name.toLowerCase()} in the binder to write, or
              double-click this {levelName(selected.levelId).toLowerCase()} to give it a title.
            </p>
          </div>
        ) : loadError ? (
          <div className="placeholder">
            <p className="error">{loadError}</p>
          </div>
        ) : (
          <div className="placeholder muted">Loading…</div>
        )}

        {appearanceOpen && <AppearancePanel controls={look} onClose={() => setAppearanceOpen(false)} />}

        <footer className="statusbar">
          <span>
            {selected?.kind === 'unit' && (
              <>
                {unitWords.toLocaleString()} words
                {target && (
                  <span className={unitWords > target.max ? 'over' : unitWords >= target.min ? 'ok' : ''}>
                    {' '}
                    · target {target.min.toLocaleString()}–{target.max.toLocaleString()}
                  </span>
                )}
              </>
            )}
          </span>
          <span className={`save save--${saveState}`} aria-live="polite">
            {savedLabel}
          </span>
        </footer>
      </section>
      )}
    </div>
  );
}
