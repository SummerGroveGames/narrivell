import { useEffect, useState } from 'react';
import { forgetKey, hasKey, listModels, saveKey } from '../ai/client';
import { chatModels, PROVIDERS, type ProviderId, providerInfo } from '../ai/providers';
import { type AiSettings as Settings, readAiSettings, writeAiSettings } from '../ai/settings';
import { isDesktop } from '../pwa';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Settings › AI connections. */
export function AiSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Settings>(readAiSettings);
  const [keys, setKeys] = useState<Partial<Record<ProviderId, boolean>>>({});
  const [selected, setSelected] = useState<ProviderId>(settings.provider ?? 'anthropic');
  const [keyText, setKeyText] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; text: string } | null>(null);
  const [notice, setNotice] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [track, setTrack] = useState(settings.trackAiContent);
  const info = providerInfo(selected);

  const update = (change: Partial<Settings>) => {
    const next = { ...settings, ...change };
    setSettings(next);
    writeAiSettings(next);
  };

  useEffect(() => {
    if (!isDesktop) return;
    for (const p of PROVIDERS) hasKey(p.id).then((has) => setKeys((k) => ({ ...k, [p.id]: has }))).catch(() => undefined);
  }, []);

  useEffect(() => {
    setModels([]);
    setStatus(null);
    setKeyText('');
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const loadModels = async () => {
    setStatus({ kind: 'busy', text: `Connecting to ${info.name}…` });
    try {
      const list = chatModels(await listModels(selected));
      setModels(list);
      if (!list.length) setStatus({ kind: 'error', text: info.needsKey ? 'Connected, but no text models are available to this key.' : 'Ollama is running but has no models yet. Download one with Ollama first.' });
      else {
        setStatus({ kind: 'ok', text: `Connected – ${list.length} models available. Pick one below.` });
        if (!settings.models[selected] || !list.includes(settings.models[selected]!)) {
          update({ models: { ...settings.models, [selected]: list[0] }, provider: settings.provider ?? selected });
        }
      }
    } catch (e) {
      setStatus({ kind: 'error', text: message(e) });
    }
  };

  const storeKey = async () => {
    try {
      await saveKey(selected, keyText);
      setKeyText('');
      setKeys((k) => ({ ...k, [selected]: true }));
      await loadModels();
    } catch (e) {
      setStatus({ kind: 'error', text: message(e) });
    }
  };

  const removeKey = async () => {
    if (!window.confirm(`Remove your ${info.name} key from this computer?`)) return;
    try {
      await forgetKey(selected);
      setKeys((k) => ({ ...k, [selected]: false }));
      setModels([]);
      setStatus({ kind: 'ok', text: 'Key removed.' });
    } catch (e) {
      setStatus({ kind: 'error', text: message(e) });
    }
  };

  const model = settings.models[selected];
  const ready = (id: ProviderId) => (providerInfo(id).needsKey ? keys[id] : true) && !!settings.models[id];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="ai-title" onMouseDown={onClose}>
      <section className="card dialog dialog--wide" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="ai-title">AI connections</h2>
        {!isDesktop ? (
          <p className="notice">AI features work in the Windows and Linux apps.</p>
        ) : (
          <>
            <div className="sheet__row ai-switch">
              <div>
                <strong>Allow AI features</strong>
                <p className="muted small">
                  Off until you turn it on. Text is only sent when you ask – one chapter at a time, to the service you choose, using your own
                  account. Narrivell has no server and never sees your text or your keys.
                </p>
              </div>
              <input
                type="checkbox"
                className="toggle"
                aria-label="Allow AI features"
                checked={settings.enabled}
                onChange={(e) => {
                  if (e.target.checked && !settings.acknowledged) setNotice(true);
                  else update({ enabled: e.target.checked });
                }}
              />
            </div>

            <div className="ai-providers" role="radiogroup" aria-label="AI service">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected === p.id}
                  className={`ai-provider ${selected === p.id ? 'ai-provider--on' : ''}`}
                  onClick={() => setSelected(p.id)}
                >
                  <strong>{p.name}</strong>
                  <span className="muted small">{p.company}</span>
                  <span className={`pill ${ready(p.id) ? 'pill--done' : ''}`}>
                    {settings.provider === p.id && ready(p.id) ? 'In use' : ready(p.id) ? 'Ready' : p.needsKey ? (keys[p.id] ? 'Pick a model' : 'No key') : 'Not set up'}
                  </span>
                </button>
              ))}
            </div>

            <div className="ai-detail">
              <p className="small">{info.note}</p>
              {info.needsKey ? (
                <div className="field">
                  <span>{info.name} API key</span>
                  <div className="row row--tight">
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={keys[selected] ? 'A key is saved – paste a new one to replace it' : 'Paste your key'}
                      value={keyText}
                      onChange={(e) => setKeyText(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="button button--small" disabled={!keyText.trim()} onClick={storeKey}>
                      Save key
                    </button>
                    {keys[selected] && (
                      <button type="button" className="link-button" onClick={removeKey}>
                        Remove
                      </button>
                    )}
                  </div>
                  <span className="muted small">
                    Get one at {info.keyHelp}. It’s stored in your computer’s keychain and only ever sent to {info.company}.
                  </span>
                </div>
              ) : (
                <p className="muted small">{info.keyHelp}. Narrivell only connects to Ollama on this computer.</p>
              )}

              <div className="field">
                <span>Model</span>
                <div className="row row--tight">
                  {models.length ? (
                    <select value={model ?? ''} onChange={(e) => update({ models: { ...settings.models, [selected]: e.target.value } })}>
                      {models.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="small">{model ?? 'None chosen yet'}</span>
                  )}
                  <button type="button" className="button button--quiet button--small" disabled={info.needsKey && !keys[selected]} onClick={loadModels}>
                    {models.length ? 'Refresh' : 'Connect and list models'}
                  </button>
                </div>
              </div>

              {status && <p className={`small ${status.kind === 'error' ? 'error' : status.kind === 'ok' ? 'ok-text' : 'muted'}`}>{status.text}</p>}

              <div className="row row--tight">
                <button type="button" className="button button--small" disabled={!ready(selected) || settings.provider === selected} onClick={() => update({ provider: selected })}>
                  {settings.provider === selected ? `Using ${info.name}` : `Use ${info.name}`}
                </button>
              </div>
            </div>

            <label className="check ai-ask">
              <input type="checkbox" checked={settings.trackAiContent} onChange={(e) => update({ trackAiContent: e.target.checked })} />
              Tag AI-suggested and AI-generated content in my books (helps with disclosure)
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.askBeforeSending} onChange={(e) => update({ askBeforeSending: e.target.checked })} />
              Show me what will be sent, and ask, every time
            </label>
          </>
        )}
        <div className="row">
          <button type="button" className="button button--quiet" onClick={onClose} autoFocus>
            Done
          </button>
        </div>
      </section>

      {notice && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="ai-notice-title" onMouseDown={(e) => e.stopPropagation()}>
          <section className="card dialog">
            <h2 id="ai-notice-title">Before you turn on AI</h2>
            <ul className="small ai-notice">
              <li>
                Text written or rewritten by an AI service may carry hidden <strong>watermarks</strong> – some providers mark their output so it can be
                identified as AI-generated later.
              </li>
              <li>
                Publishers, stores and contests may ask whether your book contains <strong>AI-generated</strong> or <strong>AI-generated, human-edited</strong>{' '}
                material, and some require you to disclose it.
              </li>
              <li>
                Narrivell can <strong>tag AI content</strong> in your books so you always know what came from AI and can answer those questions accurately.
                This is your choice, and you can change it any time.
              </li>
              <li>What you disclose, and to whom, is your responsibility as the author.</li>
            </ul>
            <label className="check">
              <input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} />
              Tag AI-suggested and AI-generated content in my books (recommended)
            </label>
            <label className="check" style={{ marginTop: '0.5rem' }}>
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              I understand
            </label>
            <div className="row">
              <button
                type="button"
                className="button"
                disabled={!understood}
                onClick={() => {
                  update({ enabled: true, acknowledged: true, trackAiContent: track });
                  setNotice(false);
                }}
              >
                Turn on AI features
              </button>
              <button type="button" className="button button--quiet" onClick={() => setNotice(false)}>
                Not now
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
