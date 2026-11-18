/**
 * The project folder and its project.json.
 *
 * project.json comes from disk, possibly via a sync service or from
 * someone else's machine, so it is treated as untrusted input: every field
 * is checked, unknown fields are dropped, and sizes are bounded. A damaged
 * file produces clear errors rather than a crash, and never loses text
 * (text lives in the per-unit files, not here).
 */
import type { Book, ContainerNode, Level, NumberStyle, TreeNode, UnitNode } from './structure';
import { validateTree } from './structure';
import type { FrontBackMatter, ProjectSettings, TemplateKind, WordTarget } from './templates';

export const FORMAT_VERSION = 1;
export const PROJECT_EXTENSION = '.narrivell';

/** Folder layout inside MyBook.narrivell/ */
export const LAYOUT = {
  projectFile: 'project.json',
  manuscript: 'manuscript',
  media: 'media',
  sources: 'sources',
  codex: 'codex',
  decisions: 'decisions',
  research: 'research',
  sync: '.sync',
  history: '.history',
} as const;

export interface ProjectFile {
  format: typeof FORMAT_VERSION;
  title: string;
  author: string;
  settings: ProjectSettings;
  /** Top-level nodes of the binder tree, in reading order. */
  tree: TreeNode[];
  /** Items removed from the manuscript. Their text stays on disk and can be restored. */
  trash: TreeNode[];
}

const LIMITS = {
  text: 500,
  levels: 8,
  nodes: 20_000,
  depth: 8,
  matterItems: 30,
  id: 64,
};

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const NUMBER_STYLES: NumberStyle[] = ['arabic', 'upper-roman', 'lower-roman', 'words', 'none'];
const TEMPLATES: TemplateKind[] = ['fiction', 'nonfiction', 'custom'];

class Problems {
  list: string[] = [];
  add(msg: string) {
    if (this.list.length < 50) this.list.push(msg);
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function str(v: unknown, field: string, p: Problems, max = LIMITS.text): string {
  if (typeof v !== 'string') {
    p.add(`${field} must be text.`);
    return '';
  }
  if (v.length > max) {
    p.add(`${field} is too long.`);
    return v.slice(0, max);
  }
  return v;
}

function bool(v: unknown, field: string, p: Problems): boolean {
  if (typeof v !== 'boolean') p.add(`${field} must be true or false.`);
  return v === true;
}

function id(v: unknown, field: string, p: Problems): string {
  if (typeof v !== 'string' || !ID_PATTERN.test(v)) {
    p.add(`${field} has an invalid id.`);
    return '';
  }
  return v;
}

function oneOf<T extends string>(v: unknown, options: readonly T[], field: string, p: Problems, fallback: T): T {
  if (typeof v === 'string' && (options as readonly string[]).includes(v)) return v as T;
  p.add(`${field} has an unrecognised value.`);
  return fallback;
}

function readLevel(v: unknown, i: number, p: Problems): Level {
  const f = `Level ${i + 1}`;
  if (!isObject(v)) {
    p.add(`${f} is malformed.`);
    return { id: '', name: '', numberStyle: 'none', continuous: false, compound: false, showName: false };
  }
  return {
    id: id(v.id, f, p),
    name: str(v.name, `${f} name`, p, 60),
    numberStyle: oneOf(v.numberStyle, NUMBER_STYLES, `${f} numbering`, p, 'arabic'),
    continuous: bool(v.continuous, `${f} continuous`, p),
    compound: bool(v.compound, `${f} compound`, p),
    showName: bool(v.showName, `${f} showName`, p),
  };
}

function readMatter(v: unknown, p: Problems): FrontBackMatter {
  const list = (x: unknown, field: string) => {
    if (!Array.isArray(x) || x.length > LIMITS.matterItems) {
      p.add(`${field} is malformed.`);
      return [];
    }
    return x.map((item, i) => id(item, `${field} item ${i + 1}`, p));
  };
  if (!isObject(v)) {
    p.add('Front/back matter is malformed.');
    return { front: [], back: [] };
  }
  return { front: list(v.front, 'Front matter'), back: list(v.back, 'Back matter') };
}

function readTarget(v: unknown, p: Problems): WordTarget | null {
  if (v === null) return null;
  if (
    isObject(v) &&
    Number.isInteger(v.min) &&
    Number.isInteger(v.max) &&
    (v.min as number) > 0 &&
    (v.max as number) >= (v.min as number) &&
    (v.max as number) <= 1_000_000
  ) {
    return { min: v.min as number, max: v.max as number };
  }
  p.add('Length target is malformed.');
  return null;
}

function readSettings(v: unknown, p: Problems): ProjectSettings {
  if (!isObject(v)) {
    p.add('Settings are missing.');
    v = {};
  }
  const s = v as Record<string, unknown>;
  const levelsRaw = Array.isArray(s.levels) ? s.levels : [];
  if (levelsRaw.length === 0 || levelsRaw.length > LIMITS.levels) p.add('The structure needs 1–8 levels.');
  const features = isObject(s.features) ? s.features : {};
  return {
    template: oneOf(s.template, TEMPLATES, 'Template', p, 'custom'),
    preset: id(s.preset, 'Preset', p),
    levels: levelsRaw.slice(0, LIMITS.levels).map((l, i) => readLevel(l, i, p)),
    features: {
      notes: oneOf(features.notes, ['off', 'footnotes', 'endnotes'] as const, 'Notes setting', p, 'off'),
      bibliography: bool(features.bibliography, 'Bibliography setting', p),
      figures: bool(features.figures, 'Figures setting', p),
      comments: bool(features.comments, 'Comments setting', p),
    },
    matter: readMatter(s.matter, p),
    unitTarget: readTarget(s.unitTarget ?? null, p),
  };
}

function readTree(v: unknown, p: Problems, depth: number, count: { n: number }): TreeNode[] {
  if (!Array.isArray(v)) {
    p.add('The binder is malformed.');
    return [];
  }
  if (depth > LIMITS.depth) {
    p.add('The binder is nested too deeply.');
    return [];
  }
  const out: TreeNode[] = [];
  for (const raw of v) {
    if (++count.n > LIMITS.nodes) {
      p.add('The binder has too many items.');
      break;
    }
    if (!isObject(raw)) {
      p.add('A binder item is malformed.');
      continue;
    }
    if (raw.kind === 'unit') {
      const unit: UnitNode = { kind: 'unit', id: id(raw.id, 'A unit', p), title: str(raw.title, 'A unit title', p) };
      if (raw.unnumbered === true) unit.unnumbered = true;
      out.push(unit);
    } else if (raw.kind === 'container') {
      const node: ContainerNode = {
        kind: 'container',
        id: id(raw.id, 'A section', p),
        levelId: id(raw.levelId, 'A section level', p),
        title: str(raw.title, 'A section title', p),
        children: readTree(raw.children, p, depth + 1, count),
      };
      if (raw.unnumbered === true) node.unnumbered = true;
      out.push(node);
    } else {
      p.add('A binder item has an unknown type.');
    }
  }
  return out;
}

export type ParseResult = { ok: true; project: ProjectFile } | { ok: false; problems: string[] };

/** Parses and validates project.json text. Never throws. */
export function parseProjectFile(json: string): ParseResult {
  if (json.length > 5_000_000) return { ok: false, problems: ['project.json is too large.'] };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, problems: ['project.json is not valid JSON.'] };
  }
  const p = new Problems();
  const count = { n: 0 };
  if (!isObject(raw)) return { ok: false, problems: ['project.json is malformed.'] };
  if (raw.format !== FORMAT_VERSION) {
    return {
      ok: false,
      problems: [
        typeof raw.format === 'number' && raw.format > FORMAT_VERSION
          ? 'This project was saved by a newer version of Narrivell. Please update.'
          : 'This project file format is not recognised.',
      ],
    };
  }
  const project: ProjectFile = {
    format: FORMAT_VERSION,
    title: str(raw.title, 'Title', p),
    author: str(raw.author, 'Author', p),
    settings: readSettings(raw.settings, p),
    tree: readTree(raw.tree, p, 0, count),
    trash: raw.trash === undefined ? [] : readTree(raw.trash, p, 0, count),
  };
  if (p.list.length === 0) {
    const book: Book = { structure: { levels: project.settings.levels }, children: project.tree };
    const levelIds = new Set<string>();
    for (const l of project.settings.levels) {
      if (levelIds.has(l.id)) p.add(`Two levels share the id "${l.id}".`);
      levelIds.add(l.id);
    }
    // Ids must be unique across the manuscript and the trash together.
    for (const problem of validateTree({ ...book, children: [...project.tree, ...project.trash] })) p.add(problem);
  }
  return p.list.length ? { ok: false, problems: p.list } : { ok: true, project };
}

/** Serialises a project for saving. Stable key order and indentation keep diffs readable. */
export function serializeProjectFile(project: ProjectFile): string {
  return `${JSON.stringify(project, null, 2)}\n`;
}

export function newProject(title: string, author: string, settings: ProjectSettings): ProjectFile {
  return { format: FORMAT_VERSION, title, author, settings, tree: [], trash: [] };
}

/** Random, URL-safe ids for nodes (never derived from titles, so renaming is safe). */
export function newId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
