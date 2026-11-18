import { useEffect, useState } from 'react';
import type { Book, ContainerNode, NodeNumber, TreeNode, UnitNode } from '../core/structure';
import { plainText } from '../project/doc';
import type { ProjectStore } from '../project/store';
import type { DropPosition } from '../project/tree';
import { colorFor, LABEL_COLORS, STATUS_LABELS } from './details';

type ColorBy = 'label' | 'status' | 'pov';
const STATUS_COLORS = { idea: '#9b958a', drafted: '#8aa0b8', revised: '#c9a96e', done: '#7a9c84' } as const;

interface Props {
  book: Book;
  store: ProjectStore;
  /** The section or chapter whose microchapters are shown. */
  container: ContainerNode | null;
  numbers: Map<string, NodeNumber>;
  words: Map<string, number>;
  selectedId: string | null;
  target: { min: number; max: number } | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onMove: (id: string, targetId: string, position: DropPosition) => void;
  onAdd: (afterId: string | null) => void;
}

const DRAG = 'application/x-narrivell-card';

/** Groups: the container's own microchapters, then one group per child container. */
function groups(container: ContainerNode | null, book: Book): { title: string; container: ContainerNode | null; units: UnitNode[] }[] {
  const nodes: TreeNode[] = container ? container.children : book.children;
  const out: { title: string; container: ContainerNode | null; units: UnitNode[] }[] = [];
  let loose: UnitNode[] = [];
  const flush = () => {
    if (loose.length) out.push({ title: '', container: null, units: loose });
    loose = [];
  };
  for (const n of nodes) {
    if (n.kind === 'unit') loose.push(n);
    else {
      flush();
      const units: UnitNode[] = [];
      const collect = (xs: TreeNode[]) => xs.forEach((x) => (x.kind === 'unit' ? units.push(x) : collect(x.children)));
      collect(n.children);
      out.push({ title: n.title, container: n, units });
    }
  }
  flush();
  return out;
}

export function Storyboard(props: Props) {
  const { book, store, container, numbers, words, selectedId, target, onSelect, onOpen, onMove } = props;
  const [colorBy, setColorBy] = useState<ColorBy>('label');
  const [excerpts, setExcerpts] = useState<Map<string, string>>(new Map());
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const all = groups(container, book);
  const unitIds = all.flatMap((g) => g.units.map((u) => u.id)).join(',');

  // First lines stand in for a synopsis until the author writes one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const id of unitIds.split(',').filter(Boolean).slice(0, 200)) {
        try {
          const text = plainText(await store.loadUnit(id)).replace(/\s+/g, ' ').trim();
          next.set(id, text.length > 180 ? `${text.slice(0, 180).replace(/\s\S*$/, '')}…` : text);
        } catch {
          // Damaged text shows its own message when opened.
        }
        if (cancelled) return;
      }
      setExcerpts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [unitIds, store]);

  const stripe = (u: UnitNode) => {
    const d = u.details ?? {};
    if (colorBy === 'status') return d.status ? STATUS_COLORS[d.status] : 'transparent';
    if (colorBy === 'pov') return d.pov ? colorFor(d.pov.toLowerCase()) : 'transparent';
    return d.label ? LABEL_COLORS[d.label] : 'transparent';
  };

  const allUnits = all.flatMap((g) => g.units);
  const total = allUnits.reduce((s, u) => s + (words.get(u.id) ?? 0), 0);
  const outside = target ? allUnits.filter((u) => {
    const w = words.get(u.id) ?? 0;
    return w < target.min || w > target.max;
  }).length : 0;

  const card = (u: UnitNode) => {
    const d = u.details ?? {};
    const w = words.get(u.id) ?? 0;
    const pct = target ? Math.min(100, Math.round((w / target.max) * 100)) : 0;
    const state = !target ? '' : w > target.max ? 'over' : w >= target.min ? 'ok' : 'under';
    const hint = drop?.id === u.id ? drop.position : null;
    return (
      <article
        key={u.id}
        className={`card-item ${selectedId === u.id ? 'card-item--on' : ''} ${hint ? `card-item--drop-${hint}` : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG, u.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG)) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const position: DropPosition = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
          if (drop?.id !== u.id || drop.position !== position) setDrop({ id: u.id, position });
        }}
        onDragLeave={() => setDrop((x) => (x?.id === u.id ? null : x))}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(DRAG);
          const position = drop?.position ?? 'after';
          setDrop(null);
          if (id && id !== u.id) onMove(id, u.id, position);
        }}
        onDragEnd={() => setDrop(null)}
      >
        <div className="card-item__stripe" style={{ background: stripe(u) }} />
        <button type="button" className="card-item__body" onClick={() => onSelect(u.id)} onDoubleClick={() => onOpen(u.id)} title="Click for notes · double-click to write · drag to reorder">
          <span className="card-item__top">
            <span className="card-item__num">{numbers.get(u.id)?.label || '·'}</span>
            {d.status && <span className={`pill pill--${d.status}`}>{STATUS_LABELS[d.status]}</span>}
          </span>
          <span className={`card-item__title ${u.title ? '' : 'muted'}`}>{u.title || 'Untitled'}</span>
          {d.synopsis ? (
            <span className="card-item__synopsis">{d.synopsis}</span>
          ) : (
            <span className="card-item__synopsis card-item__synopsis--excerpt">{excerpts.get(u.id) || 'Empty – double-click to start writing.'}</span>
          )}
          {(d.pov || d.where || d.when) && (
            <span className="card-item__meta">
              {d.pov && <span><b>POV</b> {d.pov}</span>}
              {d.where && <span><b>Where</b> {d.where}</span>}
              {d.when && <span><b>When</b> {d.when}</span>}
            </span>
          )}
          {d.endsOn && (
            <span className="card-item__ends">
              <b>Ends on</b> {d.endsOn}
            </span>
          )}
          <span className="card-item__words">
            {target && (
              <span className="card-item__bar" aria-hidden="true">
                <span className={`card-item__fill card-item__fill--${state}`} style={{ width: `${pct}%` }} />
              </span>
            )}
            <span>{w.toLocaleString()} words</span>
          </span>
        </button>
      </article>
    );
  };

  return (
    <div className="storyboard">
      <div className="storyboard__bar">
        <span>
          <strong>{allUnits.length}</strong> microchapters · <strong>{total.toLocaleString()}</strong> words
          {allUnits.length > 0 && <> · average <strong>{Math.round(total / allUnits.length).toLocaleString()}</strong></>}
          {target && outside > 0 && <> · <span className="warning">{outside} outside {target.min.toLocaleString()}–{target.max.toLocaleString()}</span></>}
        </span>
        <span className="storyboard__gap" />
        <label className="check">
          Colour by
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
            <option value="label">Label</option>
            <option value="status">Status</option>
            <option value="pov">POV</option>
          </select>
        </label>
      </div>
      <div className="storyboard__scroll">
        {all.map((g, i) => (
          <section key={g.container?.id ?? `loose-${i}`} className="storyboard__group">
            {g.container && (
              <h3 className="storyboard__heading">
                <button type="button" onClick={() => onSelect(g.container!.id)}>
                  {numbers.get(g.container.id)?.label} {g.title && <span>· {g.title}</span>}
                </button>
              </h3>
            )}
            <div className="storyboard__grid">
              {g.units.map(card)}
              <button type="button" className="card-add" onClick={() => props.onAdd(g.units[g.units.length - 1]?.id ?? g.container?.id ?? null)}>
                + Add microchapter
              </button>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
