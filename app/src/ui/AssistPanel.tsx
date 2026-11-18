import { useEffect, useState } from 'react';
import { type Plan, suggestBreaks } from '../assist/rules';
import type { DocNode } from '../project/doc';

interface Props {
  /** Reads the microchapter's current text from the editor. */
  getDoc: () => DocNode | null;
  target: { min: number; max: number };
  unitName: string;
  onShow: (block: number) => void;
  onAccept: (blocks: number[]) => void;
  onClose: () => void;
}

/** Microchapter assist (built-in rules): suggested breaks for the open microchapter. */
export function AssistPanel({ getDoc, target, unitName, onShow, onAccept, onClose }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const refresh = () => {
    const doc = getDoc();
    setPlan(doc ? suggestBreaks(doc, target) : null);
  };
  useEffect(() => refresh(), []);

  const strong = plan?.suggestions.filter((s) => s.strength === 'strong') ?? [];
  const name = unitName.toLowerCase();

  return (
    <aside className="side-panel" aria-label="Microchapter assist">
      <header className="side-panel__head">
        <strong>✦ Microchapter assist</strong>
        <button type="button" className="link-button" onClick={onClose}>
          Turn off
        </button>
      </header>
      <div className="side-panel__body">
        <div className="seg" role="radiogroup" aria-label="Suggestions come from">
          <button type="button" role="radio" aria-checked="true" className="on">
            Built-in rules
          </button>
          <button type="button" role="radio" aria-checked="false" disabled title="Coming soon: use your own AI provider">
            AI assist
          </button>
        </div>
        <p className="muted small">
          Looks for scene marks, jumps in time or place and strong closing lines, and keeps each {name} within{' '}
          {target.min.toLocaleString()}–{target.max.toLocaleString()} words. Works offline. Your words are never changed – only split, and every split can be merged back.
        </p>
        {!plan ? null : plan.suggestions.length === 0 ? (
          <p className="notice">This {name} is {plan.total.toLocaleString()} words – no breaks needed.</p>
        ) : (
          <>
            <div className="assist-lengths">
              <div className="lbl">If you accept them all</div>
              <div className="assist-bar">
                {plan.lengths.map((n, i) => (
                  <span key={i} style={{ flex: n }} className={n > target.max ? 'over' : n < target.min ? 'under' : 'ok'} title={`${n.toLocaleString()} words`} />
                ))}
              </div>
              <div className="muted small">{plan.lengths.map((n) => n.toLocaleString()).join(' · ')} words</div>
            </div>
            <ol className="assist-list">
              {plan.suggestions.map((s, i) => (
                <li key={s.at} className="assist-item">
                  <div className="assist-item__head">
                    <strong>Break {i + 1}</strong>
                    <span className={`pill ${s.strength === 'strong' ? 'pill--revised' : 'pill--idea'}`}>{s.strength === 'strong' ? 'Strong' : 'Possible'}</span>
                    <span className="muted small">after {s.wordsBefore.toLocaleString()} words</span>
                  </div>
                  <ul className="assist-item__why">
                    {s.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <div className="assist-item__lines">
                    <span>…{s.closing}</span>
                    <span className="assist-item__cut">✂</span>
                    <span>{s.opening}…</span>
                  </div>
                  <div className="row row--tight">
                    <button type="button" className="chip chip--quiet" onClick={() => onShow(s.at)}>
                      Show
                    </button>
                    <button type="button" className="chip" onClick={() => onAccept([s.at])}>
                      Split here
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="assist-actions">
              {strong.length > 0 && strong.length < plan.suggestions.length && (
                <button type="button" className="button button--quiet button--small" onClick={() => onAccept(strong.map((s) => s.at))}>
                  Accept the {strong.length} strong break{strong.length === 1 ? '' : 's'}
                </button>
              )}
              <button type="button" className="button button--small" onClick={() => onAccept(plan.suggestions.map((s) => s.at))}>
                Accept all {plan.suggestions.length}
              </button>
              <button type="button" className="link-button" onClick={refresh}>
                Look again
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
