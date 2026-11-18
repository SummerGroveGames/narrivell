/**
 * Turns a Word document's paragraphs into blocks of text with suggested
 * breaks (sections, chapters, microchapters), then builds binder items and
 * unit texts from the breaks the author keeps. Nothing here changes the
 * author's words: breaks only decide where the text is divided.
 */
import { newId } from '../core/projectFile';
import type { ContainerNode, Level, TreeNode, UnitNode } from '../core/structure';
import type { DocNode } from '../project/doc';
import type { Run, WordParagraph } from './docx';

export type FormatMode = 'all' | 'emphasis' | 'plain';
export type Confidence = 'certain' | 'likely' | 'possible';
/** What kind of break the file suggests, before it is matched to the book's levels. */
export type BreakRole = 'top' | 'chapter' | 'special' | 'scene';

export interface Block {
  kind: 'text' | 'heading' | 'scene';
  runs: Run[];
  text: string;
  /** Empty paragraphs that came right before this block. */
  emptyBefore: number;
}

export interface Break {
  /** The block this break comes before (for headings: the heading block itself). */
  at: number;
  role: BreakRole;
  /** Index into the book's levels; null = no break (dismissed). */
  level: number | null;
  title: string;
  unnumbered: boolean;
  confidence: Confidence;
  reason: string;
  /** The number the file itself gave, e.g. 27 in "27 — The Island". */
  fileNumber: number | null;
  /** The word the file uses for this level, e.g. "Sequence". */
  word: string | null;
}

export interface Analysis {
  blocks: Block[];
  breaks: Break[];
  stats: { paragraphs: number; emptyRemoved: number; mergedHeadingsSplit: number; words: number };
}

const TOP = /^(sequence|part|book|act|volume)\s+([ivxlcdm]+|\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\.?$/i;
const SPECIAL = /^(prologue|epilogue|interlude|introduction|afterword|foreword|preface|coda)$/i;
const CHAPTER_NUM = /^(?:chapter\s+)?([1-9]\d{0,2})\s*(?:[—–:.\-](?!\d)\s*(.*))?$/i;
const CHAPTER_WORD = /^chapter\s+([a-z-]+|[ivxlcdm]+)(?:\s*[—–:.\-]\s*(.*))?$/i;
const SCENE = /^[^\p{L}\p{N}]{1,12}$/u;

const words = (s: string) => (s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length;
const titleCase = (s: string) =>
  s === s.toUpperCase() && /[A-Z]/.test(s) ? s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) : s;
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Strong clues only: a heading style, heading colour or large type (not just bold or centred). */
function strongClue(p: WordParagraph): boolean {
  return p.headingLevel !== null || !!p.color || (p.size !== null && p.size >= 14);
}

function headingClue(p: WordParagraph): string | null {
  if (p.headingLevel !== null) return `uses the “${p.style}” style`;
  if (p.color) return 'is coloured like a heading';
  if (p.size !== null && p.size >= 14) return 'uses large type';
  if (p.align === 'center' && p.text.trim().length <= 60) return 'is centred';
  if (p.runs.length > 0 && p.runs.every((r) => !r.text.trim() || r.bold) && p.text.trim().length <= 60) return 'is bold';
  return null;
}

/** Splits "6 — Title⏎First line of text" into a heading paragraph and a text paragraph. */
function splitMergedHeading(p: WordParagraph): WordParagraph[] {
  const nl = p.text.indexOf('\n');
  if (nl <= 0) return [p];
  const first = p.text.slice(0, nl).trim();
  if (!(CHAPTER_NUM.test(first) || CHAPTER_WORD.test(first) || TOP.test(first) || SPECIAL.test(first)) || first.length > 90) return [p];
  const head: Run[] = [];
  const rest: Run[] = [];
  let seen = 0;
  for (const r of p.runs) {
    const start = seen;
    seen += r.text.length;
    if (seen <= nl) head.push(r);
    else if (start > nl) rest.push(r);
    else {
      const cut = nl - start;
      if (cut > 0) head.push({ ...r, text: r.text.slice(0, cut) });
      rest.push({ ...r, text: r.text.slice(cut + 1) });
    }
  }
  return [
    { ...p, runs: head, text: head.map((r) => r.text).join('') },
    { ...p, runs: rest, text: rest.map((r) => r.text).join(''), headingLevel: null, color: null, size: null, align: '' },
  ];
}

export function analyse(paragraphs: WordParagraph[]): Analysis {
  const blocks: Block[] = [];
  const breaks: Break[] = [];
  let empties = 0;
  let emptyRemoved = 0;
  let merged = 0;
  let total = 0;

  const expanded: WordParagraph[] = [];
  for (const p of paragraphs) {
    const parts = splitMergedHeading(p);
    if (parts.length > 1) merged++;
    expanded.push(...parts);
  }

  for (const p of expanded) {
    const text = p.text.replace(/\t/g, ' ');
    if (!text.trim()) {
      empties++;
      emptyRemoved++;
      continue;
    }
    const line = tidy(text);
    const single = !text.trim().includes('\n') && line.length <= 90;
    const clue = headingClue(p);
    const at = blocks.length;
    let heading: Omit<Break, 'at' | 'level'> | null = null;

    if (single) {
      let m: RegExpExecArray | null;
      if ((m = TOP.exec(line))) {
        heading = { role: 'top', title: '', unnumbered: false, confidence: clue ? 'certain' : 'likely', reason: `“${line}” looks like a ${m[1].toLowerCase()} heading${clue ? ` and ${clue}` : ''}`, fileNumber: null, word: titleCase(m[1]) };
      } else if ((m = SPECIAL.exec(line))) {
        heading = { role: 'special', title: titleCase(line), unnumbered: true, confidence: clue ? 'certain' : 'likely', reason: `“${titleCase(line)}” is usually unnumbered${clue ? `; it ${clue}` : ''}`, fileNumber: null, word: null };
      } else if ((m = CHAPTER_NUM.exec(line)) && (m[2] || strongClue(p))) {
        heading = { role: 'chapter', title: tidy(m[2] ?? ''), unnumbered: false, confidence: clue ? 'certain' : 'likely', reason: `Numbered heading${clue ? ` that ${clue}` : ''}`, fileNumber: Number(m[1]), word: /^chapter/i.test(line) ? 'Chapter' : null };
      } else if ((m = CHAPTER_WORD.exec(line))) {
        heading = { role: 'chapter', title: tidy(m[2] ?? ''), unnumbered: false, confidence: 'certain', reason: 'Starts with “Chapter”', fileNumber: null, word: 'Chapter' };
      } else if (p.headingLevel !== null && line.length <= 60) {
        heading = { role: 'chapter', title: line, unnumbered: false, confidence: 'likely', reason: `Uses the “${p.style}” style`, fileNumber: null, word: null };
      }
    }

    if (heading) {
      blocks.push({ kind: 'heading', runs: p.runs, text: line, emptyBefore: empties });
      breaks.push({ at, level: null, ...heading });
    } else if (SCENE.test(line)) {
      blocks.push({ kind: 'scene', runs: p.runs, text: line, emptyBefore: empties });
      breaks.push({ at, role: 'scene', level: null, title: '', unnumbered: false, confidence: 'likely', reason: `Scene-break mark “${line}”`, fileNumber: null, word: null });
    } else {
      if (empties >= 3 && blocks.length > 0) {
        breaks.push({ at, role: 'scene', level: null, title: '', unnumbered: false, confidence: 'possible', reason: `${empties} empty lines in a row – maybe a scene break, maybe just spacing`, fileNumber: null, word: null });
      }
      blocks.push({ kind: 'text', runs: p.runs, text, emptyBefore: empties });
      total += words(text);
    }
    empties = 0;
  }
  // Chapter numbers should run in order. A numbered "heading" that breaks the run
  // (a list item, a time in a log) is only suggested, not assumed.
  let previous: number | null = null;
  for (const b of breaks) {
    if (b.role !== 'chapter' || b.fileNumber === null) continue;
    if (previous !== null && b.fileNumber !== previous + 1 && b.confidence !== 'certain') {
      b.confidence = 'possible';
      b.reason = `Numbered ${b.fileNumber}, which doesn’t follow chapter ${previous} – probably not a heading`;
      continue;
    }
    previous = b.fileNumber;
  }
  return { blocks, breaks, stats: { paragraphs: paragraphs.length, emptyRemoved, mergedHeadingsSplit: merged, words: total } };
}

/**
 * Matches the file's breaks to the book's levels (outermost first; the
 * last level holds the text). "Possible" breaks start dismissed.
 */
export function assignLevels(breaks: Break[], levels: Level[]): Break[] {
  const unit = levels.length - 1;
  const chapter = levels.length >= 2 ? levels.length - 2 : unit;
  const top = levels.length >= 3 ? 0 : levels.length === 2 ? 0 : unit;
  return breaks.map((b) => {
    let level: number | null;
    if (b.confidence === 'possible') level = null;
    else if (b.role === 'top') level = top;
    else if (b.role === 'chapter' || b.role === 'special') level = chapter;
    else level = unit;
    return { ...b, level };
  });
}

function inline(runs: Run[], mode: FormatMode): DocNode[] {
  const out: DocNode[] = [];
  const cleaned = runs.map((r) => ({ ...r, text: r.text.replace(/\t/g, ' ') }));
  // Trim leading/trailing whitespace across runs.
  while (cleaned.length && !cleaned[0].text.trim() && !cleaned[0].text.includes('\n')) cleaned.shift();
  if (cleaned.length) cleaned[0] = { ...cleaned[0], text: cleaned[0].text.replace(/^[  ]+/, '') };
  const last = cleaned.length - 1;
  if (last >= 0) cleaned[last] = { ...cleaned[last], text: cleaned[last].text.replace(/[  \n]+$/, '') };

  for (const r of cleaned) {
    const marks: { type: string }[] = [];
    if (mode !== 'plain') {
      if (r.bold) marks.push({ type: 'bold' });
      if (r.italic) marks.push({ type: 'italic' });
      if (mode === 'all' && r.underline) marks.push({ type: 'underline' });
      if (mode === 'all' && r.strike) marks.push({ type: 'strike' });
    }
    r.text.split('\n').forEach((piece, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (piece) out.push(marks.length ? { type: 'text', text: piece, marks } : { type: 'text', text: piece });
    });
  }
  return out;
}

export interface BuildResult {
  nodes: TreeNode[];
  docs: Map<string, DocNode>;
  /** The block each binder item starts at (for jumping from the outline to the text). */
  starts: Map<string, number>;
}

/** Builds binder items and unit texts from the blocks and the breaks that are kept. */
export function build(blocks: Block[], breaks: Break[], levels: Level[], mode: FormatMode, makeId: () => string = newId): BuildResult {
  const unitIdx = levels.length - 1;
  const roots: TreeNode[] = [];
  const docs = new Map<string, DocNode>();
  const starts = new Map<string, number>();
  let at = 0;
  const stack: { node: ContainerNode; level: number }[] = [];
  let unit: { node: UnitNode; doc: DocNode } | null = null;
  const byBlock = new Map<number, Break>();
  for (const b of breaks) if (b.level !== null) byBlock.set(b.at, b);

  const parentList = () => (stack.length ? stack[stack.length - 1].node.children : roots);
  const newUnit = (title = '', unnumbered = false) => {
    const node: UnitNode = { kind: 'unit', id: makeId(), title };
    // The text of an unnumbered Prologue/Epilogue isn't numbered either.
    const parent = stack[stack.length - 1]?.node;
    if (unnumbered || (parent?.unnumbered && parent.children.length === 0)) node.unnumbered = true;
    const doc: DocNode = { type: 'doc', content: [] };
    parentList().push(node);
    docs.set(node.id, doc);
    starts.set(node.id, at);
    unit = { node, doc };
    return unit;
  };

  blocks.forEach((block, i) => {
    at = i;
    const br = byBlock.get(i);
    if (br && br.level !== null) {
      if (br.level < unitIdx) {
        while (stack.length && stack[stack.length - 1].level >= br.level) stack.pop();
        const node: ContainerNode = { kind: 'container', id: makeId(), levelId: levels[br.level].id, title: br.title, children: [] };
        if (br.unnumbered) node.unnumbered = true;
        parentList().push(node);
        starts.set(node.id, at);
        stack.push({ node, level: br.level });
        unit = null;
      } else {
        newUnit(br.title, br.unnumbered);
      }
      if (block.kind !== 'text') return; // the heading or scene mark became the break itself
    }
    const current = unit ?? newUnit();
    if (block.kind === 'scene') {
      current.doc.content!.push({ type: 'horizontalRule' });
    } else if (block.kind === 'heading') {
      // A dismissed heading stays in the text.
      const content = inline(block.runs, mode);
      current.doc.content!.push(mode === 'all' ? { type: 'heading', attrs: { level: 2 }, content } : { type: 'paragraph', content });
    } else {
      const content = inline(block.runs, mode);
      current.doc.content!.push(content.length ? { type: 'paragraph', content } : { type: 'paragraph' });
    }
  });

  for (const doc of docs.values()) if (!doc.content!.length) doc.content!.push({ type: 'paragraph' });
  return { nodes: roots, docs, starts };
}
