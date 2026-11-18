import { useEffect, useRef, useState } from 'react';
import type { ItemDetails, LabelColor, Status, TreeNode } from '../core/structure';
import { LABEL_COLORS, LABEL_NAMES, STATUS_LABELS } from './details';

interface Props {
  node: TreeNode;
  label: string;
  onChange: (details: ItemDetails) => void;
  onClose: () => void;
}

/** The notes panel: synopsis, status, label, POV, when, where, ending and notes for one item. */
export function NotesPanel({ node, label, onChange, onClose }: Props) {
  const [d, setD] = useState<ItemDetails>(node.details ?? {});
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(d);
  const pendingSave = useRef<(() => void) | null>(null);

  // Show the newly selected item; first finish saving the previous one.
  useEffect(() => {
    setD(node.details ?? {});
    latest.current = node.details ?? {};
    return () => {
      window.clearTimeout(timer.current);
      pendingSave.current?.();
      pendingSave.current = null;
    };
  }, [node]);

  // Save shortly after typing stops.
  const set = (change: Partial<ItemDetails>) => {
    const next = { ...latest.current, ...change };
    for (const k of Object.keys(next) as (keyof ItemDetails)[]) if (!next[k]) delete next[k];
    latest.current = next;
    setD(next);
    const save = () => onChange(next);
    pendingSave.current = save;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      pendingSave.current = null;
      save();
    }, 500);
  };

  const field = (key: 'pov' | 'when' | 'where', name: string, placeholder: string) => (
    <label className="notes__field">
      <span>{name}</span>
      <input value={d[key] ?? ''} placeholder={placeholder} maxLength={120} onChange={(e) => set({ [key]: e.target.value } as Partial<ItemDetails>)} onBlur={() => onChange(latest.current)} />
    </label>
  );

  return (
    <aside className="side-panel" aria-label="Notes">
      <header className="side-panel__head">
        <strong>Notes · {label}</strong>
        <button type="button" className="link-button" onClick={onClose}>
          Hide
        </button>
      </header>
      <div className="side-panel__body">
        <label className="notes__field">
          <span>Synopsis · shows on the storyboard</span>
          <textarea
            className="notes__synopsis"
            rows={3}
            maxLength={2000}
            value={d.synopsis ?? ''}
            placeholder="What happens here, in a line or two."
            onChange={(e) => set({ synopsis: e.target.value })}
            onBlur={() => onChange(latest.current)}
          />
        </label>
        <div className="notes__grid">
          <label className="notes__field">
            <span>Status</span>
            <select value={d.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as Status | undefined })}>
              <option value="">—</option>
              {(Object.keys(STATUS_LABELS) as Status[]).map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="notes__field">
            <span>Label</span>
            <div className="notes__labels">
              {(Object.keys(LABEL_COLORS) as LabelColor[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`notes__label ${d.label === c ? 'notes__label--on' : ''}`}
                  style={{ background: LABEL_COLORS[c] }}
                  aria-label={LABEL_NAMES[c]}
                  aria-pressed={d.label === c}
                  title={LABEL_NAMES[c]}
                  onClick={() => set({ label: d.label === c ? undefined : c })}
                />
              ))}
            </div>
          </div>
          {field('pov', 'POV', 'Whose eyes?')}
          {field('when', 'When', 'Day 4 · night')}
          {field('where', 'Where', 'The archive')}
        </div>
        <label className="notes__field">
          <span>Ends on (the hook)</span>
          <input value={d.endsOn ?? ''} maxLength={500} placeholder="The line or moment it ends on" onChange={(e) => set({ endsOn: e.target.value })} onBlur={() => onChange(latest.current)} />
        </label>
        <label className="notes__field">
          <span>Notes</span>
          <textarea rows={8} maxLength={20000} value={d.notes ?? ''} placeholder="Anything you want to remember." onChange={(e) => set({ notes: e.target.value })} onBlur={() => onChange(latest.current)} />
        </label>
      </div>
    </aside>
  );
}
