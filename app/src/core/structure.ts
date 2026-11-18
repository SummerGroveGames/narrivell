/**
 * Book structure: author-defined levels, numbering and the tree of
 * containers (Sequence, Part, Chapter…) and units (the deepest level,
 * which holds the text: microchapter, scene or chapter).
 *
 * Nothing here touches the text itself, so restructuring can never
 * change a word of the manuscript.
 */

export type NumberStyle = 'arabic' | 'upper-roman' | 'lower-roman' | 'words' | 'none';

export interface Level {
  /** Stable id, never shown to the author. */
  id: string;
  /** The author's name for this level, e.g. "Sequence", "Microchapter". */
  name: string;
  numberStyle: NumberStyle;
  /** true: numbers run through the whole book; false: restart inside each parent. */
  continuous: boolean;
  /** Show the parent's number first, e.g. 27.i, 27.ii. */
  compound: boolean;
  /** Show the level name in labels ("Sequence IV") or just the number ("27"). */
  showName: boolean;
}

/**
 * Levels are ordered from outermost to innermost. The last level is the
 * unit level (holds text). Any other level is optional at any point in the
 * tree, so a unit can sit directly under a Sequence even when a Chapter
 * level exists.
 */
export interface Structure {
  levels: Level[];
}

export interface ContainerNode {
  kind: 'container';
  id: string;
  levelId: string;
  title: string;
  children: TreeNode[];
  /** Left out of numbering, e.g. a Prologue or Epilogue. */
  unnumbered?: boolean;
}

export interface UnitNode {
  kind: 'unit';
  id: string;
  title: string;
  /** Left out of numbering, e.g. a Prologue or Epilogue. */
  unnumbered?: boolean;
}

export type TreeNode = ContainerNode | UnitNode;

export interface Book {
  structure: Structure;
  /** Top-level nodes, in reading order. */
  children: TreeNode[];
}

export function unitLevel(structure: Structure): Level {
  const last = structure.levels[structure.levels.length - 1];
  if (!last) throw new Error('A structure needs at least one level.');
  return last;
}

function levelIndex(structure: Structure, levelId: string): number {
  const i = structure.levels.findIndex((l) => l.id === levelId);
  if (i < 0) throw new Error(`Unknown level "${levelId}".`);
  return i;
}

/**
 * Checks the tree obeys the structure: containers use non-unit levels and
 * only contain deeper levels; ids are unique. Returns a list of problems
 * (empty when valid) rather than throwing, so the UI can explain them.
 */
export function validateTree(book: Book): string[] {
  const problems: string[] = [];
  const unitIdx = book.structure.levels.length - 1;
  const seen = new Set<string>();

  const visit = (nodes: TreeNode[], parentIdx: number) => {
    for (const node of nodes) {
      if (seen.has(node.id)) problems.push(`Duplicate id "${node.id}".`);
      seen.add(node.id);
      if (node.kind === 'unit') continue;
      const idx = book.structure.levels.findIndex((l) => l.id === node.levelId);
      if (idx < 0) {
        problems.push(`"${node.title}" uses an unknown level.`);
        continue;
      }
      if (idx === unitIdx) problems.push(`"${node.title}" is a container on the text level.`);
      if (idx <= parentIdx) problems.push(`"${node.title}" can't sit inside a level at or below its own.`);
      visit(node.children, idx);
    }
  };
  visit(book.children, -1);
  return problems;
}

// ---------------------------------------------------------------------------
// Number formatting
// ---------------------------------------------------------------------------

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function toWords(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} Hundred${rest ? ` and ${toWords(rest)}` : ''}`;
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [value, numeral] of table) {
    while (n >= value) {
      out += numeral;
      n -= value;
    }
  }
  return out;
}

/** Formats a positive whole number in the given style. Falls back to digits outside a style's range. */
export function formatNumber(n: number, style: NumberStyle): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Can't number item ${n}.`);
  switch (style) {
    case 'none':
      return '';
    case 'arabic':
      return String(n);
    case 'upper-roman':
      return n < 4000 ? toRoman(n) : String(n);
    case 'lower-roman':
      return n < 4000 ? toRoman(n).toLowerCase() : String(n);
    case 'words':
      return n < 1000 ? toWords(n) : String(n);
  }
}

// ---------------------------------------------------------------------------
// Numbering the whole tree
// ---------------------------------------------------------------------------

export interface NodeNumber {
  /** The number on its own, formatted ("IV", "27", "iii"); empty for style "none". */
  number: string;
  /** What the binder and exports show, e.g. "Sequence IV", "27", "27.iii". */
  label: string;
}

/**
 * Numbers every node in reading order. Continuous levels count through the
 * whole book; restarting levels count within their nearest parent container.
 */
export function numberTree(book: Book): Map<string, NodeNumber> {
  const result = new Map<string, NodeNumber>();
  const unit = unitLevel(book.structure);
  const globalCounts = new Map<string, number>();
  const localCounts = new Map<string, number>(); // key: parentId + levelId

  const next = (level: Level, parentId: string): number => {
    if (level.continuous) {
      const n = (globalCounts.get(level.id) ?? 0) + 1;
      globalCounts.set(level.id, n);
      return n;
    }
    const key = `${parentId}\u0000${level.id}`;
    const n = (localCounts.get(key) ?? 0) + 1;
    localCounts.set(key, n);
    return n;
  };

  const visit = (nodes: TreeNode[], parentId: string, parentNumber: string) => {
    for (const node of nodes) {
      const level =
        node.kind === 'unit' ? unit : book.structure.levels[levelIndex(book.structure, node.levelId)];
      if (node.unnumbered) {
        result.set(node.id, { number: '', label: '' });
        if (node.kind === 'container') visit(node.children, node.id, '');
        continue;
      }
      const n = next(level, parentId);
      const own = formatNumber(n, level.numberStyle);
      const number = level.compound && parentNumber && own ? `${parentNumber}.${own}` : own;
      const label = level.showName && level.name ? [level.name, number].filter(Boolean).join(' ') : number;
      result.set(node.id, { number, label });
      if (node.kind === 'container') visit(node.children, node.id, number);
    }
  };
  visit(book.children, 'root', '');
  return result;
}

/** Every unit in reading order, with the chain of containers above it. */
export function unitsInOrder(book: Book): { unit: UnitNode; path: ContainerNode[] }[] {
  const out: { unit: UnitNode; path: ContainerNode[] }[] = [];
  const visit = (nodes: TreeNode[], path: ContainerNode[]) => {
    for (const node of nodes) {
      if (node.kind === 'unit') out.push({ unit: node, path });
      else visit(node.children, [...path, node]);
    }
  };
  visit(book.children, []);
  return out;
}

// ---------------------------------------------------------------------------
// Restructuring (never touches text)
// ---------------------------------------------------------------------------

function findParent(nodes: TreeNode[], id: string): { list: TreeNode[]; index: number } | null {
  const index = nodes.findIndex((n) => n.id === id);
  if (index >= 0) return { list: nodes, index };
  for (const n of nodes) {
    if (n.kind === 'container') {
      const found = findParent(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Removes a node from wherever it is and returns it. */
export function detach(book: Book, id: string): TreeNode {
  const found = findParent(book.children, id);
  if (!found) throw new Error(`No node "${id}".`);
  return found.list.splice(found.index, 1)[0];
}

/** Inserts a node right after another node (same parent). */
export function insertAfter(book: Book, afterId: string, node: TreeNode): void {
  const found = findParent(book.children, afterId);
  if (!found) throw new Error(`No node "${afterId}".`);
  found.list.splice(found.index + 1, 0, node);
}

/** Moves a node to sit right after another node. Refuses to move a container inside itself. */
export function moveAfter(book: Book, id: string, afterId: string): void {
  if (id === afterId) return;
  const node = findParent(book.children, id);
  if (!node) throw new Error(`No node "${id}".`);
  const moving = node.list[node.index];
  if (moving.kind === 'container' && findParent(moving.children, afterId)) {
    throw new Error("Can't move a section inside itself.");
  }
  detach(book, id);
  insertAfter(book, afterId, moving);
}
