/**
 * Where projects live. On the desktop a project is a folder the author
 * picked; in a browser (web or development mode) it is kept in this
 * browser's storage, for trying Narrivell out only.
 */
import { newId } from '../core/projectFile';
import { MemoryProvider } from '../storage/memory';
import type { StorageProvider } from '../storage/types';

const BROWSER = 'browser:';

export const isBrowserLocation = (path: string) => path.startsWith(BROWSER);

export function newBrowserLocation(): string {
  return `${BROWSER}${newId()}`;
}

export async function providerFor(path: string): Promise<StorageProvider> {
  if (isBrowserLocation(path)) {
    const key = path.slice(BROWSER.length);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) throw new Error('Unknown project location.');
    return new MemoryProvider('This browser (for trying Narrivell only)', `narrivell.project.${key}`);
  }
  const { TauriFolderProvider } = await import('../storage/tauri');
  return new TauriFolderProvider(path);
}
