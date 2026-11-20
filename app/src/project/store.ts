/**
 * One open project: reads and writes project.json and the per-unit files.
 *
 * Saving rules (the "never lose a word" promise):
 * - Each unit is its own file, so a damaged file can only ever affect one unit.
 * - Writes go through the provider's safe write (temp file, then swap).
 * - The editor JSON is written first; the Markdown copy second.
 * - A snapshot of the unit is kept in .history the first time it is saved in
 *   a session and then at most every 15 minutes. Snapshots are never removed.
 * - Saves run one at a time, in order.
 */
import type { ProjectFile } from '../core/projectFile';
import { LAYOUT, newProject, parseProjectFile, serializeProjectFile } from '../core/projectFile';
import type { Book, UnitNode } from '../core/structure';
import type { ProjectSettings } from '../core/templates';
import { stamp } from '../storage/paths';
import type { StorageProvider } from '../storage/types';
import type { DocNode } from './doc';
import { emptyDoc, sanitizeDoc, toMarkdown } from './doc';
import { addContainer, addUnit, findNode } from './tree';

export const UNIT_FORMAT = 1;
const SNAPSHOT_EVERY_MS = 15 * 60 * 1000;

const unitJson = (id: string) => `${LAYOUT.manuscript}/${id}.json`;
const unitMd = (id: string) => `${LAYOUT.manuscript}/${id}.md`;

export type OpenResult = { ok: true; store: ProjectStore } | { ok: false; problems: string[] };

export class ProjectStore {
  private queue: Promise<unknown> = Promise.resolve();
  private lastSnapshot = new Map<string, number>();

  private constructor(
    readonly storage: StorageProvider,
    public project: ProjectFile,
    private now: () => number = Date.now,
  ) {}

  /** Creates the folder layout, project.json and a first empty unit. */
  static async create(
    storage: StorageProvider,
    title: string,
    author: string,
    settings: ProjectSettings,
    now?: () => number,
  ): Promise<ProjectStore> {
    if (await storage.readText(LAYOUT.projectFile)) {
      throw new Error('There is already a Narrivell project in that folder.');
    }
    for (const dir of [LAYOUT.manuscript, LAYOUT.media, LAYOUT.sources, LAYOUT.codex, LAYOUT.decisions, LAYOUT.research, LAYOUT.history]) {
      await storage.makeDir(dir);
    }
    const project = newProject(title, author, settings);
    const store = new ProjectStore(storage, project, now);
    // Start with one empty unit (wrapped in the first container level when there is one, so numbering looks right).
    const book = store.book;
    if (settings.levels.length > 1) addContainer(book, settings.levels[settings.levels.length - 2], null);
    else addUnit(book, null);
    await store.saveProject();
    return store;
  }

  static async open(storage: StorageProvider, now?: () => number): Promise<OpenResult> {
    const text = await storage.readText(LAYOUT.projectFile);
    if (text === null) return { ok: false, problems: ['That folder isn’t a Narrivell project (there’s no project.json).'] };
    const parsed = parseProjectFile(text);
    if (!parsed.ok) return parsed;
    return { ok: true, store: new ProjectStore(storage, parsed.project, now) };
  }

  /** A live view of the project as a Book: changes to it change the project. */
  get book(): Book {
    const project = this.project;
    return {
      structure: { levels: project.settings.levels },
      get children() {
        return project.tree;
      },
      set children(v) {
        project.tree = v;
      },
    };
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  saveProject(): Promise<void> {
    return this.run(() => this.storage.writeText(LAYOUT.projectFile, serializeProjectFile(this.project)));
  }

  /** Reads a unit's text. A missing file is an empty unit; a damaged one is cleaned, not rejected. */
  async loadUnit(id: string): Promise<DocNode> {
    const text = await this.storage.readText(unitJson(id));
    if (text === null) return emptyDoc();
    try {
      const raw = JSON.parse(text) as { format?: unknown; doc?: unknown };
      if (typeof raw.format === 'number' && raw.format > UNIT_FORMAT) {
        throw new Error('This text was saved by a newer version of Narrivell. Please update before editing it.');
      }
      return sanitizeDoc(raw.doc);
    } catch (e) {
      if (e instanceof SyntaxError) {
        throw new Error('This unit’s file is damaged. Its earlier versions are kept in the .history folder.');
      }
      throw e;
    }
  }

  saveUnit(id: string, doc: DocNode): Promise<void> {
    return this.run(async () => {
      const node = findNode(this.book, id);
      const title = node?.title ?? '';
      const json = `${JSON.stringify({ format: UNIT_FORMAT, doc })}\n`;
      const now = this.now();
      const last = this.lastSnapshot.get(id);
      if (last === undefined || now - last >= SNAPSHOT_EVERY_MS) {
        const existing = await this.storage.readText(unitJson(id));
        if (existing !== null && existing !== json) {
          await this.storage.makeDir(`${LAYOUT.history}/${id}`);
          await this.storage.writeText(`${LAYOUT.history}/${id}/${stamp(new Date(now))}.json`, existing);
        }
        this.lastSnapshot.set(id, now);
      }
      await this.storage.writeText(unitJson(id), json);
      await this.storage.writeText(unitMd(id), toMarkdown(doc, title));
    });
  }

  /** Re-reads project.json after a sync changed it. */
  async reload(): Promise<void> {
    const text = await this.storage.readText(LAYOUT.projectFile);
    if (!text) return;
    const parsed = parseProjectFile(text);
    if (parsed.ok) this.project = parsed.project;
  }

  /** Rewrites a unit's Markdown copy after its text arrived from another device. */
  async rewriteMirror(id: string): Promise<void> {
    const doc = await this.loadUnit(id);
    await this.run(() => this.storage.writeText(unitMd(id), toMarkdown(doc, findNode(this.book, id)?.title ?? '')));
  }

  /** Keeps a copy of a unit's current file in .history now (before a split or merge). */
  snapshot(id: string): Promise<void> {
    return this.run(async () => {
      const existing = await this.storage.readText(unitJson(id));
      if (existing === null) return;
      await this.storage.makeDir(`${LAYOUT.history}/${id}`);
      await this.storage.writeText(`${LAYOUT.history}/${id}/${stamp(new Date(this.now()))}.json`, existing);
    });
  }

  /** Saved versions of a unit, newest first. */
  async snapshots(id: string): Promise<string[]> {
    return (await this.storage.list(`${LAYOUT.history}/${id}`)).filter((n) => n.endsWith('.json')).reverse();
  }

  /** Waits for every pending save to finish. */
  flush(): Promise<void> {
    return this.run(async () => undefined);
  }

  unit(id: string): UnitNode | null {
    const n = findNode(this.book, id);
    return n?.kind === 'unit' ? n : null;
  }
}
