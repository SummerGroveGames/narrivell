/**
 * Syncs a project folder with its copy in the cloud.
 *
 * The local folder is always the real, complete copy. For each file the
 * engine compares this device's version and the cloud's version with the
 * version both last agreed on (kept in .sync/ on this device only):
 * - changed here only → upload;  changed there only → download;
 * - changed on both → merge (paragraph by paragraph for text, item by item
 *   for the binder), after keeping a snapshot of this device's version.
 * Nothing is ever deleted, locally or in the cloud.
 */
import { parseProjectFile, serializeProjectFile, type ProjectFile } from '../core/projectFile';
import { emptyDoc, sanitizeDoc, type DocNode } from '../project/doc';
import { stamp } from '../storage/paths';
import type { StorageProvider } from '../storage/types';
import { cleanProfile } from '../assist/profile';
import { mergeDocs, mergeProjects } from './merge';

export interface RemoteEntry {
  id: string;
  version: string;
}

/** The project's folder in a cloud service, addressed by relative path. */
export interface Remote {
  list(): Promise<Map<string, RemoteEntry>>;
  read(path: string, entry: RemoteEntry): Promise<string>;
  write(path: string, text: string, existing?: RemoteEntry): Promise<RemoteEntry>;
}

export interface SyncState {
  format: 1;
  provider: string;
  folderId: string;
  files: Record<string, { hash: string; version: string }>;
  lastSync: number | null;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  merged: number;
  /** Paths of microchapters where both devices changed the same passage. */
  conflicts: string[];
  /** Paths changed on this device by the sync. */
  changed: string[];
}

const STATE = '.sync/state.json';
const basePath = (path: string) => `.sync/base/${path.replace(/\//g, '__')}`;

export async function readSyncState(storage: StorageProvider): Promise<SyncState | null> {
  try {
    const text = await storage.readText(STATE);
    if (!text) return null;
    const raw = JSON.parse(text) as Partial<SyncState>;
    if (typeof raw.folderId !== 'string' || typeof raw.provider !== 'string') return null;
    const files: SyncState['files'] = {};
    for (const [k, v] of Object.entries(raw.files ?? {})) {
      if (v && typeof v.hash === 'string' && typeof v.version === 'string') files[k] = { hash: v.hash, version: v.version };
    }
    return { format: 1, provider: raw.provider, folderId: raw.folderId, files, lastSync: typeof raw.lastSync === 'number' ? raw.lastSync : null };
  } catch {
    return null;
  }
}

export async function writeSyncState(storage: StorageProvider, state: SyncState): Promise<void> {
  await storage.makeDir('.sync');
  await storage.writeText(STATE, `${JSON.stringify(state)}\n`);
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Which files travel with the book. Markdown copies are rebuilt locally; .sync stays on this device. */
export function syncable(path: string): boolean {
  if (path.startsWith('.sync/') || path.endsWith('.saving')) return false;
  if (path === 'project.json' || path === 'assist-profile.json') return true;
  if (/^manuscript\/[A-Za-z0-9_-]+\.json$/.test(path)) return true;
  if (/^\.history\/[A-Za-z0-9_-]+\/[A-Za-z0-9._-]+\.json$/.test(path)) return true;
  return /^(codex|decisions|research|sources)\/[A-Za-z0-9._ -]+\.(json|md|txt)$/.test(path);
}

async function localFiles(storage: StorageProvider): Promise<string[]> {
  const out: string[] = [];
  for (const f of ['project.json', 'assist-profile.json']) if ((await storage.readText(f)) !== null) out.push(f);
  for (const dir of ['manuscript', 'codex', 'decisions', 'research', 'sources']) for (const n of await storage.list(dir)) out.push(`${dir}/${n}`);
  for (const id of await storage.list('.history')) for (const n of await storage.list(`.history/${id}`)) out.push(`.history/${id}/${n}`);
  return out.filter(syncable);
}

async function mergeText(path: string, base: string | null, local: string, remote: string): Promise<{ text: string; conflict: boolean }> {
  if (path === 'project.json') {
    const parse = (t: string | null): ProjectFile | null => {
      if (!t) return null;
      const r = parseProjectFile(t);
      return r.ok ? r.project : null;
    };
    const l = parse(local);
    const r = parse(remote);
    if (!l || !r) return { text: l ? local : remote, conflict: true };
    const { project, ok } = mergeProjects(parse(base), l, r);
    return { text: serializeProjectFile(project), conflict: !ok };
  }
  if (path === 'assist-profile.json') {
    const b = base ? cleanProfile(JSON.parse(base)) : null;
    const l = cleanProfile(JSON.parse(local));
    const r = cleanProfile(JSON.parse(remote));
    const max = (x: Record<string, number | undefined>, y: Record<string, number | undefined>) =>
      Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, Math.max(x[k] ?? 0, y[k] ?? 0)]));
    const merged = {
      ...l,
      houseRules: b && l.houseRules === b.houseRules ? r.houseRules : l.houseRules,
      accepted: max(l.accepted, r.accepted),
      dismissed: max(l.dismissed, r.dismissed),
      lengths: [...l.lengths, ...r.lengths.slice(b?.lengths.length ?? 0)],
      endings: [...new Set([...l.endings, ...r.endings])],
    };
    return { text: `${JSON.stringify(cleanProfile(merged), null, 2)}\n`, conflict: false };
  }
  if (path.startsWith('manuscript/')) {
    const doc = (t: string | null): DocNode => {
      try {
        return t ? sanitizeDoc((JSON.parse(t) as { doc?: unknown }).doc) : emptyDoc();
      } catch {
        return emptyDoc();
      }
    };
    const { doc: merged, conflicts } = mergeDocs(base ? doc(base) : { type: 'doc', content: [] }, doc(local), doc(remote));
    return { text: `${JSON.stringify({ format: 1, doc: merged })}\n`, conflict: conflicts > 0 };
  }
  // Anything else (notes and the like): keep this device's version; the other is saved in .history.
  return { text: local, conflict: true };
}

export async function syncProject(storage: StorageProvider, remote: Remote, state: SyncState, now = Date.now): Promise<SyncResult> {
  const result: SyncResult = { uploaded: 0, downloaded: 0, merged: 0, conflicts: [], changed: [] };
  const remoteFiles = await remote.list();
  const paths = [...new Set([...(await localFiles(storage)), ...[...remoteFiles.keys()].filter(syncable)])];
  // The binder last, so it reflects every microchapter already merged.
  paths.sort((a, b) => (a === 'project.json' ? 1 : b === 'project.json' ? -1 : a.localeCompare(b)));

  for (const path of paths) {
    const local = await storage.readText(path);
    const localHash = local !== null ? await hashText(local) : null;
    const known = state.files[path];
    const there = remoteFiles.get(path);
    const localChanged = local !== null && (!known || known.hash !== localHash);
    const remoteChanged = !!there && (!known || known.version !== there.version);
    const isHistory = path.startsWith('.history/');
    const keepBase = async (text: string) => {
      if (!isHistory) {
        await storage.makeDir('.sync/base');
        await storage.writeText(basePath(path), text);
      }
    };

    if (localChanged && !remoteChanged) {
      const entry = await remote.write(path, local!, there);
      state.files[path] = { hash: localHash!, version: entry.version };
      await keepBase(local!);
      result.uploaded++;
    } else if (remoteChanged && !localChanged) {
      const text = await remote.read(path, there!);
      await ensureDir(storage, path);
      await storage.writeText(path, text);
      state.files[path] = { hash: await hashText(text), version: there!.version };
      await keepBase(text);
      result.downloaded++;
      result.changed.push(path);
    } else if (localChanged && remoteChanged) {
      const text = await remote.read(path, there!);
      if ((await hashText(text)) === localHash) {
        state.files[path] = { hash: localHash!, version: there!.version };
        await keepBase(text);
        continue;
      }
      if (isHistory) {
        // Snapshots are never edited; keep ours and leave theirs in the cloud.
        state.files[path] = { hash: localHash!, version: there!.version };
        continue;
      }
      // Keep a copy of this device's version before merging.
      const id = path.startsWith('manuscript/') ? path.slice(11, -5) : path.replace(/[^A-Za-z0-9_-]/g, '-');
      await storage.makeDir(`.history/${id}`);
      await storage.writeText(`.history/${id}/${stamp(new Date(now()))}-before-sync.json`, local!);
      const base = await storage.readText(basePath(path));
      const merged = await mergeText(path, base, local!, text);
      await storage.writeText(path, merged.text);
      const entry = await remote.write(path, merged.text, there);
      state.files[path] = { hash: await hashText(merged.text), version: entry.version };
      await keepBase(merged.text);
      result.merged++;
      result.changed.push(path);
      if (merged.conflict) result.conflicts.push(path);
    }
  }
  state.lastSync = now();
  await writeSyncState(storage, state);
  return result;
}

async function ensureDir(storage: StorageProvider, path: string) {
  const dir = path.split('/').slice(0, -1).join('/');
  if (dir) await storage.makeDir(dir);
}
