/// <reference types="vite/client" />

/** App version from app/package.json, injected at build time. */
declare const __APP_VERSION__: string;

/** Chrome/Edge/Android install prompt (not yet in the standard DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
}
