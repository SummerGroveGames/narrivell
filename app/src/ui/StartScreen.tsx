import { useState } from 'react';
import { isDesktop } from '../pwa';
import type { RecentProject } from '../project/recent';
import { isBrowserLocation } from '../project/locations';
import { pickFolder } from '../storage/native';

interface Props {
  recent: RecentProject[];
  onNew: () => void;
  onOpen: (path: string) => Promise<void>;
  onForget: (path: string) => void;
  onError: (message: string) => void;
}

export function StartScreen({ recent, onNew, onOpen, onForget, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const shown = recent.filter((r) => isDesktop !== isBrowserLocation(r.path));

  const open = async (choose: Promise<string | null>) => {
    setBusy(true);
    try {
      const path = await choose;
      if (path) await onOpen(path);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell">
      <header className="masthead">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="masthead__logo" />
        <div>
          <h1>Narrivell</h1>
          <p className="tagline">A writing app that never loses a word.</p>
        </div>
      </header>

      {!isDesktop && (
        <p className="notice">
          You’re using Narrivell in a browser. Projects here are kept in this browser only and are for trying
          things out. Use the Windows or Linux app for your real manuscripts.
        </p>
      )}

      <section className="card">
        <h2>Start writing</h2>
        <div className="row">
          <button type="button" className="button" onClick={onNew} disabled={busy}>
            New project…
          </button>
          {isDesktop && (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => open(pickFolder('Open a Narrivell project folder'))}
            >
              Open project…
            </button>
          )}
        </div>
      </section>

      {shown.length > 0 && (
        <section className="card">
          <h2>Recent projects</h2>
          <ul className="recent">
            {shown.map((r) => (
              <li key={r.path}>
                <button type="button" className="recent__open" disabled={busy} onClick={() => open(Promise.resolve(r.path))}>
                  <strong>{r.title || 'Untitled'}</strong>
                  <span className="muted small">{isBrowserLocation(r.path) ? 'In this browser' : r.path}</span>
                </button>
                <button
                  type="button"
                  className="link-button"
                  aria-label={`Remove ${r.title || 'Untitled'} from this list`}
                  onClick={() => onForget(r.path)}
                >
                  Remove from list
                </button>
              </li>
            ))}
          </ul>
          <p className="muted small">Removing a project from this list doesn’t touch its files.</p>
        </section>
      )}
    </main>
  );
}
