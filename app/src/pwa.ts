/** Installable-app plumbing: offline support, storage protection, install prompt. */

/** True in the installed Windows/Android app (Tauri), false in the web version. */
export const isDesktop = import.meta.env.MODE === 'desktop';

export const serviceWorkerSupported = 'serviceWorker' in navigator;

/**
 * Registers the service worker (production builds only, so development
 * always shows fresh code) and hands it the list of files this page
 * loaded, so a single visit is enough to work offline.
 */
export async function registerServiceWorker(): Promise<boolean> {
  // The installed app ships its files inside the app, so it needs no service worker.
  if (isDesktop || !serviceWorkerSupported || !import.meta.env.PROD) return false;
  const base = import.meta.env.BASE_URL;
  await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  const registration = await navigator.serviceWorker.ready;

  const urls = new Set<string>([new URL(base, location.href).href]);
  for (const entry of performance.getEntriesByType('resource')) {
    if (entry.name.startsWith(location.origin)) urls.add(entry.name.split('#')[0]);
  }
  registration.active?.postMessage({ type: 'CACHE_URLS', urls: [...urls] });
  return true;
}

/**
 * Asks the browser not to evict our data under storage pressure.
 * Returns true/false, or null when the browser has no such API.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export function isInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

type InstallListener = (canInstall: boolean) => void;
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<InstallListener>();

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  listeners.forEach((l) => l(true));
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((l) => l(false));
});

export function onInstallAvailable(listener: InstallListener): () => void {
  listeners.add(listener);
  listener(deferredPrompt !== null);
  return () => {
    listeners.delete(listener);
  };
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((l) => l(false));
  return outcome === 'accepted';
}
