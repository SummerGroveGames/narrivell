/** Plain-language labels for the app's safety checks. */

export type Check = 'ok' | 'pending' | 'unavailable';

export function storageCheck(persisted: boolean | null): { state: Check; label: string } {
  if (persisted === true) {
    return { state: 'ok', label: 'Protected – the browser won’t clear your work to free up space' };
  }
  if (persisted === false) {
    return {
      state: 'pending',
      label: 'Not yet protected – install the app to keep the browser from clearing it',
    };
  }
  return { state: 'unavailable', label: 'This browser can’t protect storage' };
}

/** The desktop operating system, from the WebView's user agent (Windows: WebView2, Linux: WebKitGTK). */
export function desktopPlatform(userAgent: string): 'Windows' | 'Linux' | 'macOS' | 'desktop' {
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux|X11/i.test(userAgent)) return 'Linux';
  return 'desktop';
}

export function offlineCheck(ready: boolean, supported: boolean): { state: Check; label: string } {
  if (!supported) return { state: 'unavailable', label: 'This browser can’t work offline' };
  return ready
    ? { state: 'ok', label: 'Ready – Narrivell opens without an internet connection' }
    : { state: 'pending', label: 'Getting ready…' };
}
