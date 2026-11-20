import { useEffect, useState } from 'react';
import { chat } from '../ai/client';
import { buildMicrochapterRequest, parseMicrochapterAnswer } from '../ai/microchapters';
import { providerInfo } from '../ai/providers';
import { openAiSettings, readAiSettings, writeAiSettings } from '../ai/settings';
import { describeProfile, emptyProfile, learned, loadProfile, type Profile, recordAccepted, recordDismissed, saveProfile } from '../assist/profile';
import { type Plan, type Suggestion, suggestBreaks } from '../assist/rules';
import type { DocNode } from '../project/doc';
import type { StorageProvider } from '../storage/types';

/** Title and ending to give each new part when a split is accepted. */
export interface PartMeta {
  title?: string;
  endsOn?: string;
  aiTitle?: boolean;
}

interface Props {
  /** Reads the microchapter's current text from the editor. */
  getDoc: () => DocNode | null;
  target: { min: number; max: number };
  unitName: string;
  /** E.g. "Chapter 27" – shown in the send preview. */
  label: string;
  storage: StorageProvider;
  onShow: (block: number) => void;
  onAccept: (blocks: number[], parts: PartMeta[]) => void;
  onClose: () => void;
}

type Mode = 'rules' | 'ai';
const MODE_KEY = 'narrivell.assist-mode';

/** Microchapter assist: suggested breaks from the built-in rules or the author's chosen AI. */
export function AssistPanel({ getDoc, target, unitName, label, storage, onShow, onAccept, onClose }: Props) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(MODE_KEY) === 'ai' ? 'ai' : 'rules'));
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [ai, setAi] = useState(readAiSettings);
  const [stage, setStage] = useState<'idle' | 'confirm' | 'asking' | 'error'>('idle');
  const [error, setError] = useState('');
  const [dontAsk, setDontAsk] = useState(false);
  const name = unitName.toLowerCase();

  useEffect(() => {
    loadProfile(storage).then(setProfile);
    const onChange = () => setAi(readAiSettings());
    window.addEventListener('narrivell:ai-settings-changed', onChange);
    return () => window.removeEventListener('narrivell:ai-settings-changed', onChange);
  }, [storage]);

  const keep = (p: Profile) => {
    setProfile(p);
    void saveProfile(storage, p).catch(() => undefined);
  };

  const runRules = (p: Profile = profile) => {
    const doc = getDoc();
    setPlan(doc ? suggestBreaks(doc, target, learned(p)) : null);
  };

  // Switching mode starts fresh; the rules run straight away, the AI waits to be asked.
  useEffect(() => {
    setPlan(null);
    setStage('idle');
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // harmless
    }
    if (mode === 'rules') runRules();
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const provider = ai.provider ? providerInfo(ai.provider) : null;
  const model = ai.provider ? ai.models[ai.provider] : undefined;
  const aiReady = ai.enabled && !!provider && !!model;
  const doc = getDoc();
  const request = doc && aiReady && stage === 'confirm' ? buildMicrochapterRequest(doc, { target, label, profile, unitName }) : null;

  const askAi = async () => {
    const current = getDoc();
    if (!ai.provider || !model || !current) return;
    if (dontAsk) writeAiSettings({ ...ai, askBeforeSending: false });
    setStage('asking');
    setError('');
    try {
      const req = buildMicrochapterRequest(current, { target, label, profile, unitName });
      const answer = await chat(ai.provider, model, req.system, req.prompt);
      setPlan(parseMicrochapterAnswer(answer, current));
      setStage('idle');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  };

  /** Accepts some of the plan's breaks, with titles and endings for each new part. */
  const accept = (chosen: Suggestion[]) => {
    if (!plan || !chosen.length) return;
    const ats = [...new Set(chosen.map((s) => s.at))].sort((a, b) => a - b);
    const segmentStarts = [0, ...plan.suggestions.map((s) => s.at)];
    const pieceStarts = [0, ...ats];
    const parts: PartMeta[] = pieceStarts.map((start, k) => {
      const end = pieceStarts[k + 1] ?? Infinity;
      const titleFrom = start === 0 ? plan.firstTitle : plan.suggestions.find((s) => s.at === start)?.title;
      // The AI's ending applies only if the piece ends exactly where one of its segments ends.
      const segment = segmentStarts.findIndex((_s, j) => (segmentStarts[j + 1] ?? Infinity) === end);
      const endsOn = plan.endings && segment >= 0 ? plan.endings[segment] : undefined;
      return { title: titleFrom || undefined, endsOn: endsOn || undefined, aiTitle: !!titleFrom };
    });
    // Learn from what was kept, and the lengths that result.
    const cumulative = new Map<number, number>();
    let run = 0;
    for (const s of plan.suggestions) {
      run += s.wordsBefore;
      cumulative.set(s.at, run);
    }
    const marks = [0, ...ats.map((a) => cumulative.get(a) ?? 0), plan.total];
    keep(recordAccepted(profile, chosen, marks.slice(1).map((m, i) => m - marks[i])));
    onAccept(ats, parts);
  };

  const dismiss = (s: Suggestion) => {
    keep(recordDismissed(profile, s));
    setPlan((p) => (p ? { ...p, suggestions: p.suggestions.filter((x) => x !== s) } : p));
  };

  const strong = plan?.suggestions.filter((s) => s.strength === 'strong') ?? [];

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
          <button type="button" role="radio" aria-checked={mode === 'rules'} className={mode === 'rules' ? 'on' : ''} onClick={() => setMode('rules')}>
            Built-in rules
          </button>
          <button type="button" role="radio" aria-checked={mode === 'ai'} className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>
            AI assist
          </button>
        </div>

        {mode === 'rules' ? (
          <p className="muted small">
            Offline. Looks for scene marks, jumps in time or place and strong closing lines, and keeps each {name} near{' '}
            {target.min.toLocaleString()}–{target.max.toLocaleString()} words. {describeProfile(profile)}
          </p>
        ) : !aiReady ? (
          <div className="notice">
            <p className="small" style={{ margin: 0 }}>
              {ai.enabled ? 'Choose an AI service and model to use.' : 'AI features are off.'} You can use Claude, ChatGPT, Gemini, Grok, Venice or a model on this
              computer, with your own account.
            </p>
            <button type="button" className="button button--small" style={{ marginTop: '0.6rem' }} onClick={openAiSettings}>
              Set up AI connections…
            </button>
          </div>
        ) : stage === 'confirm' && request ? (
          <div className="ai-preview">
            <strong>
              Send this {name} to {provider!.name}?
            </strong>
            <ul className="small">
              <li>
                {label}: {request.words.toLocaleString()} words in {request.paragraphs} numbered paragraphs
              </li>
              <li>
                Your length target{profile.houseRules.trim() ? ', your rules' : ''}
                {profile.endings.length ? ' and a few endings you kept before' : ''}
              </li>
              <li>
                Nothing else from your book. Sent with your own {provider!.company} account (model {model}).
              </li>
            </ul>
            <details className="small">
              <summary>See exactly what’s sent</summary>
              <pre className="ai-preview__text">{`${request.system}\n\n${request.prompt.slice(0, 4000)}${request.prompt.length > 4000 ? '\n…' : ''}`}</pre>
            </details>
            <label className="check">
              <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} />
              Don’t ask again
            </label>
            <div className="row row--tight">
              <button type="button" className="button button--small" onClick={askAi}>
                Send
              </button>
              <button type="button" className="button button--quiet button--small" onClick={() => setStage('idle')}>
                Cancel
              </button>
            </div>
          </div>
        ) : stage === 'asking' ? (
          <p className="notice">
            {provider!.name} is reading the {name}… this can take a minute for a long chapter.
          </p>
        ) : (
          <>
            <p className="muted small">
              Using <strong>{provider!.name}</strong> ({model}). It suggests where to divide this {name}, with a title and the hook each part ends on. Your
              words are never changed.{' '}
              <button type="button" className="link-button" onClick={openAiSettings}>
                Change
              </button>
            </p>
            {stage === 'error' && <p className="error small">{error}</p>}
            {doc && (
              <button type="button" className="button button--small" onClick={() => (ai.askBeforeSending ? setStage('confirm') : void askAi())}>
                {plan ? `Ask ${provider!.name} again` : `Ask ${provider!.name} for suggestions`}
              </button>
            )}
          </>
        )}

        <details className="assist-rules">
          <summary>Your {name} rules</summary>
          <textarea
            rows={4}
            maxLength={4000}
            defaultValue={profile.houseRules}
            key={profile.houseRules ? 'loaded' : 'empty'}
            placeholder={`E.g. “End every ${name} on a hook. Never split a flashback. Keep interrogation scenes whole.”`}
            onBlur={(e) => keep({ ...profile, houseRules: e.target.value })}
          />
          <span className="muted small">The AI follows these first. They’re saved with the book.</span>
        </details>

        {plan &&
          (plan.suggestions.length === 0 ? (
            <p className="notice">
              No breaks needed – this {name} is {plan.total.toLocaleString()} words.
            </p>
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
                      {s.source === 'ai' && <span className="pill pill--drafted">AI</span>}
                      <span className="muted small">after {s.wordsBefore.toLocaleString()} words</span>
                    </div>
                    {s.title && (
                      <div className="assist-item__title">
                        Next title: <em>{s.title}</em>
                      </div>
                    )}
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
                      <button type="button" className="chip" onClick={() => accept([s])}>
                        Split here
                      </button>
                      <button type="button" className="link-button" onClick={() => dismiss(s)} title="Not a good place – Narrivell learns from this">
                        Not here
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="assist-actions">
                {strong.length > 0 && strong.length < plan.suggestions.length && (
                  <button type="button" className="button button--quiet button--small" onClick={() => accept(strong)}>
                    Accept the {strong.length} strong break{strong.length === 1 ? '' : 's'}
                  </button>
                )}
                <button type="button" className="button button--small" onClick={() => accept(plan.suggestions)}>
                  Accept all {plan.suggestions.length}
                </button>
                {mode === 'rules' && (
                  <button type="button" className="link-button" onClick={() => runRules()}>
                    Look again
                  </button>
                )}
              </div>
            </>
          ))}
      </div>
    </aside>
  );
}
