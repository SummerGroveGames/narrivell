import { describe, expect, it } from 'vitest';
import { LAYOUT } from '../core/projectFile';
import { fictionSettings } from '../core/templates';
import { MemoryProvider } from '../storage/memory';
import { ProjectStore } from './store';
import { firstUnit } from './tree';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

describe('ProjectStore', () => {
  it('creates a project that can be opened again', async () => {
    const storage = new MemoryProvider();
    const store = await ProjectStore.create(storage, 'The Stillness Index', 'Adam Lenke', fictionSettings('sections-microchapters'));
    expect(store.project.tree.length).toBe(1);
    const reopened = await ProjectStore.open(storage);
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.store.project.title).toBe('The Stillness Index');
  });

  it('refuses to create over an existing project', async () => {
    const storage = new MemoryProvider();
    await ProjectStore.create(storage, 'A', '', fictionSettings());
    let failed = false;
    await ProjectStore.create(storage, 'B', '', fictionSettings()).catch(() => (failed = true));
    expect(failed).toBe(true);
  });

  it('explains a folder without a project', async () => {
    const result = await ProjectStore.open(new MemoryProvider());
    expect(result.ok).toBe(false);
  });

  it('saves text with a Markdown copy and keeps snapshots of earlier versions', async () => {
    let now = 0;
    const storage = new MemoryProvider();
    const store = await ProjectStore.create(storage, 'Book', '', fictionSettings(), () => now);
    const id = firstUnit(store.project.tree)!.id;

    await store.saveUnit(id, doc('first'));
    expect(await store.snapshots(id)).toEqual([]); // nothing earlier to keep
    now += 60_000;
    await store.saveUnit(id, doc('second')); // same session, too soon for another snapshot
    expect(await store.snapshots(id)).toEqual([]);
    now += 15 * 60_000;
    await store.saveUnit(id, doc('third'));
    const snaps = await store.snapshots(id);
    expect(snaps.length).toBe(1);
    expect(await storage.readText(`${LAYOUT.history}/${id}/${snaps[0]}`)).toContain('second');

    expect(await store.loadUnit(id)).toEqual(doc('third'));
    expect(await storage.readText(`manuscript/${id}.md`)).toContain('third');
  });

  it('takes a snapshot on the first save after reopening', async () => {
    const storage = new MemoryProvider();
    const store = await ProjectStore.create(storage, 'Book', '', fictionSettings());
    const id = firstUnit(store.project.tree)!.id;
    await store.saveUnit(id, doc('yesterday'));
    const reopened = await ProjectStore.open(storage);
    if (!reopened.ok) throw new Error('should open');
    await reopened.store.saveUnit(id, doc('today'));
    expect((await reopened.store.snapshots(id)).length).toBe(1);
  });

  it('reports a damaged unit instead of overwriting it', async () => {
    const storage = new MemoryProvider();
    const store = await ProjectStore.create(storage, 'Book', '', fictionSettings());
    const id = firstUnit(store.project.tree)!.id;
    await storage.writeText(`manuscript/${id}.json`, '{broken');
    let message = '';
    await store.loadUnit(id).catch((e: Error) => (message = e.message));
    expect(message).toContain('damaged');
  });

  it('keeps saves in order', async () => {
    const storage = new MemoryProvider();
    const store = await ProjectStore.create(storage, 'Book', '', fictionSettings());
    const id = firstUnit(store.project.tree)!.id;
    void store.saveUnit(id, doc('a'));
    void store.saveUnit(id, doc('b'));
    await store.saveUnit(id, doc('c'));
    expect(await store.loadUnit(id)).toEqual(doc('c'));
  });
});
