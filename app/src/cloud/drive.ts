/** Google Drive, via the desktop app's Rust side (src-tauri/src/cloud.rs). */
import type { Remote, RemoteEntry } from '../sync/engine';
import { isDesktop } from '../pwa';

async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!isDesktop) throw new Error('Cloud sync works in the Windows and Linux apps.');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Something went wrong talking to Google Drive.');
  }
}

export interface DriveItem {
  id: string;
  name: string;
  folder: boolean;
  version: string;
}

export const cloudStatus = () => call<{ registered: boolean; connected: boolean }>('cloud_status');
export const connectDrive = () => call<string>('cloud_connect');
export const disconnectDrive = () => call<void>('cloud_disconnect');
/** Lists a folder; with no id, Narrivell's own top folder in Drive. Returns [folderId, items]. */
export const listDrive = (parent?: string) => call<[string, DriveItem[]]>('drive_list', { parent: parent ?? null });
export const makeDriveFolder = (parent: string, name: string) => call<string>('drive_mkdir', { parent, name });

/** A project's folder in Google Drive, addressed by relative path like "manuscript/abc.json". */
export class DriveRemote implements Remote {
  private folders = new Map<string, string>();

  constructor(private rootId: string) {
    this.folders.set('', rootId);
  }

  async list(): Promise<Map<string, RemoteEntry>> {
    const out = new Map<string, RemoteEntry>();
    const queue: [string, string][] = [['', this.rootId]];
    while (queue.length) {
      const [prefix, id] = queue.shift()!;
      const [, items] = await listDrive(id);
      for (const item of items) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.folder) {
          this.folders.set(path, item.id);
          queue.push([path, item.id]);
        } else if (!out.has(path)) out.set(path, { id: item.id, version: item.version });
      }
    }
    return out;
  }

  read(_path: string, entry: RemoteEntry): Promise<string> {
    return call<string>('drive_read', { id: entry.id });
  }

  private async folderFor(dir: string): Promise<string> {
    const known = this.folders.get(dir);
    if (known) return known;
    const parts = dir.split('/');
    const parentDir = parts.slice(0, -1).join('/');
    const parent = await this.folderFor(parentDir);
    const id = await makeDriveFolder(parent, parts[parts.length - 1]);
    this.folders.set(dir, id);
    return id;
  }

  async write(path: string, text: string, existing?: RemoteEntry): Promise<RemoteEntry> {
    const parts = path.split('/');
    const parent = await this.folderFor(parts.slice(0, -1).join('/'));
    const [id, version] = await call<[string, string]>('drive_write', { parent, name: parts[parts.length - 1], id: existing?.id ?? null, text });
    return { id, version };
  }
}
