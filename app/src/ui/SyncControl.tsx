import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudStatus, DriveRemote, listDrive, makeDriveFolder } from '../cloud/drive';
import type { ProjectStore } from '../project/store';
import { isDesktop } from '../pwa';
import { readSyncState, type SyncResult, type SyncState, syncProject, writeSyncState } from '../sync/engine';

const EVERY_MS = 3 * 60 * 1000;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

interface Props {
  store: ProjectStore;
  /** Saves anything typed but not yet saved. */
  beforeSync: () => Promise<void>;
  afterSync: (result: SyncResult) => Promise<void>;
  onError: (message: string) => void;
}

/** The sync line at the bottom of the binder: link the book to Google Drive, sync now, last synced. */
export function SyncControl({ store, beforeSync, afterSync, onError }: Props) {
  const [state, setState] = useState<SyncState | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  const running = useRef(false);

  useEffect(() => {
    if (!isDesktop) return;
    readSyncState(store.storage).then(setState);
    const check = () => cloudStatus().then((s) => setConnected(s.connected)).catch(() => setConnected(false));
    void check();
    window.addEventListener('narrivell:cloud-changed', check);
    return () => window.removeEventListener('narrivell:cloud-changed', check);
  }, [store]);

  const sync = useCallback(
    async (linked: SyncState, quiet = false) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      try {
        await beforeSync();
        await store.flush();
        const result = await syncProject(store.storage, new DriveRemote(linked.folderId), linked);
        setState({ ...linked });
        await afterSync(result);
        if (result.conflicts.length) {
          onError(
            `Synced. ${result.conflicts.length} microchapter${result.conflicts.length === 1 ? ' was' : 's were'} changed in the same place on both computers – both versions are kept, marked with ⚠. Your earlier version is in its history.`,
          );
        }
      } catch (e) {
        if (!quiet) onError(`Couldn’t sync: ${message(e)} Your book is safe on this computer.`);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [store, beforeSync, afterSync, onError],
  );

  // Sync when the book opens, then every few minutes while it's open.
  useEffect(() => {
    if (!state || !connected) return;
    void sync(state, true);
    const timer = window.setInterval(() => void sync(state, true), EVERY_MS);
    const clock = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
    // Only when the link or connection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.folderId, connected]);

  const link = async () => {
    if (!connected) {
      window.dispatchEvent(new Event('narrivell:open-cloud-settings'));
      return;
    }
    setBusy(true);
    try {
      const name = store.storage.label.split(/[\\/]/).filter(Boolean).pop() ?? `${store.project.title}.narrivell`;
      const [top, items] = await listDrive();
      const existing = items.find((i) => i.folder && i.name === name);
      if (existing && !window.confirm(`There’s already a “${name}” in your Narrivell folder on Google Drive. Sync with it? Changes on both sides will be merged.`)) return;
      const folderId = existing?.id ?? (await makeDriveFolder(top, name));
      const linked: SyncState = { format: 1, provider: 'google', folderId, files: {}, lastSync: null };
      await writeSyncState(store.storage, linked);
      setState(linked);
    } catch (e) {
      onError(`Couldn’t set up sync: ${message(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!isDesktop) return null;
  if (!state) {
    return (
      <button type="button" className="link-button sync-line" onClick={link} disabled={busy}>
        ☁ Sync this book to Google Drive…
      </button>
    );
  }
  return (
    <button type="button" className="link-button sync-line" onClick={() => void sync(state)} disabled={busy} title="Sync now">
      {busy ? '☁ Syncing…' : !connected ? '☁ Google Drive not connected' : `☁ Synced ${state.lastSync ? ago(state.lastSync) : 'never'} · Sync now`}
    </button>
  );
}
