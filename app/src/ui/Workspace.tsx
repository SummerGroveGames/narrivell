import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { pageStyle } from '../appearance/appearance';
import type { AppearanceControls } from '../appearance/useAppearance';
import { type ContainerNode, type ItemDetails, insertAfter, numberTree, type UnitNode, unitsInOrder } from '../core/structure';
import { newId } from '../core/projectFile';
import { isDesktop } from '../pwa';
import type { DocNode } from '../project/doc';
import { countWords, plainText, sanitizeDoc } from '../project/doc';
import { mergeDocs, splitAtBlocks } from '../project/split';
import type { ProjectStore } from '../project/store';
import { addContainer, addUnit, displayLabel, findNode, firstUnit, moveNode, nudge, pathTo, removeToTrash, rename } from '../project/tree';
import { AppearancePanel } from './AppearancePanel';
import { ImportScreen } from './ImportScreen';
import { Binder } from './Binder';
import { Editor } from './Editor';
import type { Editor as TiptapEditor } from '@tiptap/react';
import { AssistPanel } from './AssistPanel';
import { NotesPanel } from './NotesPanel';
import { Storyboard } from './Storyboard';

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

  // --- Split and merge -------------------------------------------------------------
  const editorRef = useRef<TiptapEditor | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const currentDoc = (): DocNode | null => (editorRef.current ? (editorRef.current.getJSON() as DocNode) : (doc?.doc ?? null));

  const splitInto = async (unitId: string, parts: DocNode[]) => {
    if (parts.length < 2) return;
    try {
      // Save what's on screen, keep a snapshot of it, then divide it.
      window.clearTimeout(timer.current);
      pending.current = null;
      const whole = currentDoc();
      if (whole && doc?.id === unitId) await store.saveUnit(unitId, whole);
      await store.snapshot(unitId);
      let after = unitId;
      const ids: string[] = [];
      for (let k = 1; k < parts.length; k++) {
        const unit: UnitNode = { kind: 'unit', id: newId(), title: '' };
        insertAfter(book, after, unit);
        after = unit.id;
        ids.push(unit.id);
      }
      await store.saveUnit(unitId, parts[0]);
      for (let k = 0; k < ids.length; k++) await store.saveUnit(ids[k], parts[k + 1]);
      await store.saveProject();
      setWords((w) => {
        const next = new Map(w);
        next.set(unitId, countWords(plainText(parts[0])));
        ids.forEach((id, k) => next.set(id, countWords(plainText(parts[k + 1]))));
        return next;
      });
      setDoc({ id: unitId, doc: parts[0] });
      setEditorKey((k) => k + 1);
      setSaveState('saved');
      refresh();
    } catch (e) {
      onError(`Couldn’t split: ${message(e)}. Your text is unchanged.`);
    }
  };

  const splitAtCursor = () => {
    const ed = editorRef.current;
    if (!ed || selected?.kind !== 'unit') return;
    const pos = ed.state.selection.from;
    const first = sanitizeDoc(ed.state.doc.cut(0, pos).toJSON());
    const second = sanitizeDoc(ed.state.doc.cut(pos).toJSON());
    if (!plainText(first).trim() || !plainText(second).trim()) {
      onError(`Put the cursor where the new ${unitLevel.name.toLowerCase()} should start, then press Split here.`);
      return;
    }
    void splitInto(selected.id, [first, second]);
  };

  const mergeWithNext = async (id: string) => {
    const found = pathTo(book.children, id);
    if (!found) return;
    const list = found.above.length ? found.above[found.above.length - 1].children : book.children;
    const next = list[list.findIndex((n) => n.id === id) + 1];
    if (!next || next.kind !== 'unit' || found.node.kind !== 'unit') {
      onError(`There’s no ${unitLevel.name.toLowerCase()} right after this one in the same chapter to merge with.`);
      return;
    }
    if (!window.confirm(`Merge “${displayLabel(book, next)}” into “${displayLabel(book, found.node)}”? A snapshot of both is kept, and you can split them again.`)) return;
    try {
      await flush();
      await store.snapshot(id);
      await store.snapshot(next.id);
      const merged = mergeDocs(await store.loadUnit(id), await store.loadUnit(next.id));
      await store.saveUnit(id, merged);
      removeToTrash(book, store.project.trash, next.id);
      await store.saveProject();
      setWords((w) => new Map(w).set(id, countWords(plainText(merged))).set(next.id, 0));
      if (doc?.id === id) setDoc({ id, doc: merged });
      setEditorKey((k) => k + 1);
      setSelectedId(id);
      refresh();
    } catch (e) {
      onError(`Couldn’t merge: ${message(e)}. Nothing was changed.`);
    }
  };

  const showBlock = (index: number) => {
    const ed = editorRef.current;
    if (!ed) return;
    let pos = 0;
    ed.state.doc.forEach((_node, offset, i) => {
      if (i === index) pos = offset;
    });
    ed.chain().setTextSelection(pos + 1).focus().run();
    (ed.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const saveDetails = (id: string, details: ItemDetails) => {
    const node = findNode(book, id);
    if (!node) return;
    if (Object.keys(details).length) node.details = details;
    else delete node.details;
    void saveStructure();
  };

  // --- Views -----------------------------------------------------------------------
  const [view, setView] = useState<'write' | 'storyboard'>('write');
  const [notesOpen, setNotesOpen] = useState(true);
  const [assistOn, setAssistOn] = useState(false);
  const shownView = selected?.kind === 'container' ? 'storyboard' : view;
  const parentOf = (id: string): ContainerNode | null => {
    const found = pathTo(book.children, id);
    return found && found.above.length ? found.above[found.above.length - 1] : null;
  };
  const boardContainer = selected ? (selected.kind === 'container' ? selected : parentOf(selected.id)) : null;
  const numbers = numberTree(book);
  const crumbs = selected ? (pathTo(book.children, selected.id)?.above ?? []) : [];
  const assistTarget = target ?? { min: 1000, max: 2000 };
  const showAssist = assistOn && shownView === 'write' && selected?.kind === 'unit' && doc?.id === selected.id;

  const savedLabel = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', failed: 'Not saved – retrying' }[saveState];
  const a = look.appearance;

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
          {levels.slice(0, -1).map((level) => (
            <button key={level.id} type="button" className="chip chip--quiet" onClick={() => act(() => addContainer(book, level, selectedId).unit.id)}>
              + {level.name}
            </button>
          ))}
          <button type="button" className="chip chip--quiet" onClick={() => void flush().then(() => setImporting(true))}>
            Import Word…
          </button>
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
            onMerge={(id) => void mergeWithNext(id)}
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
          <header className="viewbar">
            <div className="viewbar__where">
              <div className="viewbar__crumbs">{crumbs.map((c) => displayLabel(book, c, numbers)).join(' › ') || store.project.title}</div>
              <div className="viewbar__title">{selected ? displayLabel(book, selected, numbers) : ''}</div>
            </div>
            <div className="seg seg--page" role="tablist" aria-label="View">
              <button
                type="button"
                role="tab"
                aria-selected={shownView === 'write'}
                className={shownView === 'write' ? 'on' : ''}
                disabled={selected?.kind === 'container'}
                title={selected?.kind === 'container' ? `Select a ${unitLevel.name.toLowerCase()} to write` : 'Write'}
                onClick={() => setView('write')}
              >
                Write
              </button>
              <button type="button" role="tab" aria-selected={shownView === 'storyboard'} className={shownView === 'storyboard' ? 'on' : ''} onClick={() => setView('storyboard')}>
                Storyboard
              </button>
            </div>
            <span className="viewbar__gap" />
            {shownView === 'write' && selected?.kind === 'unit' && (
              <label className={`assist-toggle ${assistOn ? 'assist-toggle--on' : ''}`}>
                ✦ Microchapter assist
                <input type="checkbox" className="toggle" checked={assistOn} onChange={(e) => setAssistOn(e.target.checked)} />
              </label>
            )}
            <button
              type="button"
              className={`tool ${notesOpen && !showAssist ? 'tool--on' : ''}`}
              title="Notes panel"
              aria-label="Notes panel"
              aria-pressed={notesOpen}
              onClick={() => {
                setAssistOn(false);
                setNotesOpen((o) => !(o && !showAssist));
              }}
            >
              ☰
            </button>
            <button
              type="button"
              className={`tool ${appearanceOpen ? 'tool--on' : ''}`}
              data-appearance-toggle
              title="Appearance: font, page colour, layout, night light"
              aria-label="Appearance"
              aria-expanded={appearanceOpen}
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
              onClick={() => onFocusChange(!focus)}
            >
              ⛶
            </button>
          </header>

          <div className="main__body">
            <div className="main__content">
              {shownView === 'storyboard' ? (
                <Storyboard
                  book={book}
                  store={store}
                  container={boardContainer}
                  numbers={numbers}
                  words={words}
                  selectedId={selectedId}
                  target={target}
                  onSelect={select}
                  onOpen={(id) => {
                    setSelectedId(id);
                    setView('write');
                  }}
                  onMove={(id, targetId, position) => {
                    const problem = moveNode(book, id, targetId, position);
                    if (problem) onError(problem);
                    else void saveStructure();
                  }}
                  onAdd={(afterId) => act(() => addUnit(book, afterId).id)}
                />
              ) : selected?.kind === 'unit' && doc?.id === selected.id ? (
                <>
                  <header className="unit-head">
                    <span className="unit-head__label">{numbers.get(selected.id)?.label}</span>
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
                    key={`${doc.id}-${editorKey}`}
                    initial={doc.doc}
                    typewriter={a.typewriter}
                    onReady={(ed) => (editorRef.current = ed)}
                    onSplit={splitAtCursor}
                    onChange={(d) => onChange(doc.id, d)}
                  />
                </>
              ) : loadError ? (
                <div className="placeholder">
                  <p className="error">{loadError}</p>
                </div>
              ) : (
                <div className="placeholder muted">Loading…</div>
              )}
            </div>

            {showAssist ? (
              <AssistPanel
                key={`${selected!.id}-${editorKey}`}
                getDoc={currentDoc}
                target={assistTarget}
                unitName={unitLevel.name}
                onShow={showBlock}
                onAccept={(blocks) => {
                  const whole = currentDoc();
                  if (whole) void splitInto(selected!.id, splitAtBlocks(whole, blocks));
                }}
                onClose={() => setAssistOn(false)}
              />
            ) : (
              notesOpen &&
              selected && (
                <NotesPanel
                  node={selected}
                  label={displayLabel(book, selected, numbers)}
                  onChange={(d) => saveDetails(selected.id, d)}
                  onClose={() => setNotesOpen(false)}
                />
              )
            )}
          </div>

          {appearanceOpen && <AppearancePanel controls={look} onClose={() => setAppearanceOpen(false)} />}

          <footer className="statusbar">
            <span>
              {selected?.kind === 'unit' ? (
                <>
                  {unitWords.toLocaleString()} words
                  {target && (
                    <span className={unitWords > target.max ? 'over' : unitWords >= target.min ? 'ok' : ''}>
                      {' '}
                      · target {target.min.toLocaleString()}–{target.max.toLocaleString()}
                    </span>
                  )}
                </>
              ) : selected?.kind === 'container' ? (
                containerSummary(selected)
              ) : null}
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
