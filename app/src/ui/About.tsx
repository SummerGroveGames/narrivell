import { useEffect, useState } from 'react';
import {
  isDesktop,
  isInstalled,
  onInstallAvailable,
  promptInstall,
  registerServiceWorker,
  requestPersistentStorage,
  serviceWorkerSupported,
} from '../pwa';
import { type Check, desktopPlatform, offlineCheck, storageCheck } from '../lib/status';

export const platform = desktopPlatform(navigator.userAgent);

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

/** Starts the offline/storage set-up once, when the app opens (web only). */
export function usePlatformSetup() {
  const [offlineReady, setOfflineReady] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(isInstalled());

  useEffect(() => {
    registerServiceWorker()
      .then(setOfflineReady)
      .catch(() => setOfflineReady(false));
    requestPersistentStorage().then(setPersisted);
    const unsubscribe = onInstallAvailable(setCanInstall);
    const onInstalled = () => {
      setInstalled(true);
      requestPersistentStorage().then(setPersisted);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      unsubscribe();
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return { offlineReady, persisted, canInstall, installed };
}

export function About({ setup, onClose }: { setup: ReturnType<typeof usePlatformSetup>; onClose: () => void }) {
  const { offlineReady, persisted, canInstall, installed } = setup;
  const offline = isDesktop
    ? { state: 'ok' as Check, label: 'Built in – Narrivell never needs an internet connection' }
    : import.meta.env.PROD
      ? offlineCheck(offlineReady, serviceWorkerSupported)
      : { state: 'unavailable' as Check, label: 'Off in development – use the deployed app to test this' };
  const storage = isDesktop
    ? { state: 'ok' as Check, label: 'Your projects are ordinary folders you choose – nothing clears them' }
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
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={onClose}>
      <section className="card dialog" onClick={(e) => e.stopPropagation()}>
        <header className="masthead masthead--small">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="masthead__logo" />
          <div>
            <h2 id="about-title">Narrivell</h2>
            <p className="tagline">
              Version {__APP_VERSION__} · Summer Grove Software
            </p>
          </div>
        </header>
        <ul className="statuses">
          <StatusRow title="Works offline" {...offline} />
          <StatusRow title="Storage" {...storage} />
          <StatusRow title="Installed" state={installState} label={installLabel} />
        </ul>
        <p className="muted small">
          No accounts, no tracking, no telemetry. Your writing stays in files you control.
        </p>
        <div className="row">
          {!isDesktop && !installed && canInstall && (
            <button type="button" className="button" onClick={() => promptInstall()}>
              Install Narrivell
            </button>
          )}
          <button type="button" className="button button--quiet" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
