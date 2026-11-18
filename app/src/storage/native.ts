/** Desktop-only abilities, loaded lazily so the web version never pulls them in. */
import { isDesktop } from '../pwa';

/**
 * Shows the system folder picker. The chosen folder (and only that folder)
 * becomes writable by Narrivell; the Rust side grants it. Returns null if
 * cancelled or when running in a browser.
 */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isDesktop) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('pick_folder', { title });
}

/** Creates a new folder inside a picked folder. Refuses to reuse an existing one. */
export async function createFolder(parent: string, name: string): Promise<string> {
  const { exists, mkdir } = await import('@tauri-apps/plugin-fs');
  const path = `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${name}`;
  if (await exists(path)) {
    throw new Error(`A folder called “${name}” already exists there. Choose another title or location.`);
  }
  await mkdir(path);
  return path;
}

/** Opens a mailto: link in the author's own mail app. Nothing else can be opened. */
export async function openMail(link: string): Promise<void> {
  if (!link.startsWith('mailto:')) throw new Error('Only email links can be opened.');
  if (isDesktop) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(link);
  } else {
    window.location.href = link;
  }
}

/**
 * Lets the author pick a Word file and returns its bytes. The Rust side reads
 * just that one file; no folder access is granted. Null if cancelled.
 */
export async function pickImportFile(): Promise<Uint8Array | null> {
  if (!isDesktop) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const buffer = await invoke<ArrayBuffer>('pick_import_file');
  return buffer.byteLength ? new Uint8Array(buffer) : null;
}
