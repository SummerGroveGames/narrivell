import { useEffect, useState } from 'react';
import {
  isDesktop,
  isInstalled,
  onInstallAvailable,
  promptInstall,
  registerServiceWorker,
  requestPersistentStorage,
  serviceWorkerSupported,
} from './pwa';
import { type Check, desktopPlatform, offlineCheck, storageCheck } from './lib/status';

const platform = desktopPlatform(navigator.userAgent);

function StatusRow({ title, state, label }: { title: string; state: Check; label: string }) {
  const mark = state === 'ok' ? '✓' : state === 'pending' ? '…' : '–';
  return (
    <li className={`status status--${state}`}>
      <span className="status__mark" aria-hidden="true">
        {mark}
      </span>
      <span>
        <strong>{title}</strong>
        <br />
        {label}
      </span>
    </li>
  );
}

export default function App() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(isInstalled());
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    registerServiceWorker()
      .then(setOfflineReady)
      .catch(() => setOfflineReady(false));
    requestPersistentStorage().then(setPersisted);

    const unsubscribe = onInstallAvailable(setCanInstall);
    const updateOnline = () => setOnline(navigator.onLine);
    const onInstalled = () => {
      setInstalled(true);
      requestPersistentStorage().then(setPersisted);
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      unsubscribe();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const offline = isDesktop
    ? { state: 'ok' as Check, label: 'Built in – Narrivell never needs an internet connection' }
    : import.meta.env.PROD
      ? offlineCheck(offlineReady, serviceWorkerSupported)
      : { state: 'unavailable' as Check, label: 'Off in development – use the deployed app to test this' };
  const storage = isDesktop
    ? { state: 'ok' as Check, label: 'Saved in your user profile on this computer – nothing clears it' }
    : storageCheck(persisted);
  const installState: Check = isDesktop || installed ? 'ok' : 'pending';
  const installLabel = isDesktop
    ? `Installed as a ${platform} app`
    : installed
      ? 'Running as an installed app'
      : canInstall
        ? 'Install Narrivell to open it like any other app'
        : 'Use your browser’s menu → “Install app” or “Add to Home screen”';

  return (
    <main className="shell">
      <header className="masthead">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="masthead__logo" />
        <div>
          <h1>Narrivell</h1>
          <p className="tagline">A writing app that never loses a word.</p>
        </div>
      </header>

      <section className="card">
        <h2>Your setup</h2>
        <ul className="statuses">
          <StatusRow title="Works offline" {...offline} />
          <StatusRow title="Storage" {...storage} />
          <StatusRow title="Installed" state={installState} label={installLabel} />
        </ul>
        {!isDesktop && !installed && canInstall && (
          <button type="button" className="button" onClick={() => promptInstall()}>
            Install Narrivell
          </button>
        )}
      </section>

      <section className="card card--quiet">
        <h2>Coming next</h2>
        <p>
          Import your Word manuscript, organise it into parts, chapters, sections and
          microchapters, and write with autosave and snapshots.
        </p>
      </section>

      <footer className="footer">
        <span className={online ? 'dot dot--online' : 'dot dot--offline'} aria-hidden="true" />
        {online ? 'Online' : 'Offline'} · Narrivell v{__APP_VERSION__} · Summer Grove Software
        {/* In the Windows app a plain link would replace the app window with the web page. */}
        {!isDesktop && (
          <>
            {' · '}
            <a href="https://github.com/SummerGroveGames/narrivell">Source</a>
          </>
        )}
      </footer>
    </main>
  );
}
