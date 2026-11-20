import { describe, expect, it } from 'vitest';
import { newProject, serializeProjectFile } from '../core/projectFile';
import { fictionSettings } from '../core/templates';
import { MemoryProvider } from '../storage/memory';
import { type Remote, type RemoteEntry, type SyncState, syncProject } from './engine';
import { CONFLICT_NOTE } from './merge';

class FakeCloud implements Remote {
  files = new Map<string, { text: string; version: number }>();
  async list() {
    return new Map([...this.files].map(([p, f]) => [p, { id: p, version: String(f.version) } as RemoteEntry]));
  }
  async read(path: string) {
    return this.files.get(path)!.text;
  }
  async write(path: string, text: string) {
    const version = (this.files.get(path)?.version ?? 0) + 1;
    this.files.set(path, { text, version });
    return { id: path, version: String(version) };
  }
}

const unit = (...paras: string[]) =>
  `${JSON.stringify({ format: 1, doc: { type: 'doc', content: paras.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })) } })}\n`;
const fresh = (): SyncState => ({ format: 1, provider: 'test', folderId: 'f', files: {}, lastSync: null });

async function device(cloud: FakeCloud) {
  const storage = new MemoryProvider();
  return { storage, state: fresh(), sync: function () { return syncProject(this.storage, cloud, this.state); } };
}

describe('sync between two devices', () => {
  it('uploads from one device and downloads on the other', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    const project = newProject('Book', '', fictionSettings());
    project.tree = [{ kind: 'unit', id: 'u1', title: '' }];
    await a.storage.writeText('project.json', serializeProjectFile(project));
    await a.storage.writeText('manuscript/u1.json', unit('Hello'));
    await a.storage.writeText('manuscript/u1.md', 'not synced');
    const up = await a.sync();
    expect(up.uploaded).toBe(2);
    expect(cloud.files.has('manuscript/u1.md')).toBe(false);

    const b = await device(cloud);
    const down = await b.sync();
    expect(down.downloaded).toBe(2);
    expect(await b.storage.readText('manuscript/u1.json')).toBe(unit('Hello'));
    expect((await b.sync()).uploaded + (await b.sync()).downloaded).toBe(0);
  });

  it('merges edits made on both devices and keeps a snapshot first', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.storage.writeText('manuscript/u1.json', unit('One', 'Two', 'Three'));
    await a.sync();
    const b = await device(cloud);
    await b.sync();

    await a.storage.writeText('manuscript/u1.json', unit('One (laptop)', 'Two', 'Three'));
    await b.storage.writeText('manuscript/u1.json', unit('One', 'Two', 'Three', 'Four (desktop)'));
    await a.sync();
    const r = await b.sync();
    expect(r.merged).toBe(1);
    expect(r.conflicts).toEqual([]);
    expect(await b.storage.readText('manuscript/u1.json')).toBe(unit('One (laptop)', 'Two', 'Three', 'Four (desktop)'));
    expect((await b.storage.list('.history/u1')).length).toBe(1);
    await a.sync();
    expect(await a.storage.readText('manuscript/u1.json')).toBe(unit('One (laptop)', 'Two', 'Three', 'Four (desktop)'));
  });

  it('keeps both versions when the same paragraph changed on both', async () => {
    const cloud = new FakeCloud();
    const a = await device(cloud);
    await a.storage.writeText('manuscript/u1.json', unit('Same'));
    await a.sync();
    const b = await device(cloud);
    await b.sync();
    await a.storage.writeText('manuscript/u1.json', unit('Laptop'));
    await b.storage.writeText('manuscript/u1.json', unit('Desktop'));
    await a.sync();
    const r = await b.sync();
    expect(r.conflicts).toEqual(['manuscript/u1.json']);
    expect(await b.storage.readText('manuscript/u1.json')).toBe(unit('Desktop', CONFLICT_NOTE, 'Laptop').replace(`"text":"${CONFLICT_NOTE}"`, `"text":"${CONFLICT_NOTE}","marks":[{"type":"bold"}]`));
  });
});
