/**
 * Binder operations used by the workspace. All of them keep the tree valid
 * for its structure, and none of them touch any text.
 */
import { newId } from '../core/projectFile';
import type { Book, ContainerNode, Level, TreeNode, UnitNode } from '../core/structure';
import { detach, insertAfter, numberTree, validateTree } from '../core/structure';

/** The node and the containers above it (outermost first), or null. */
export function pathTo(nodes: TreeNode[], id: string, above: ContainerNode[] = []): { node: TreeNode; above: ContainerNode[] } | null {
  for (const n of nodes) {
    if (n.id === id) return { node: n, above };
    if (n.kind === 'container') {
      const found = pathTo(n.children, id, [...above, n]);
      if (found) return found;
    }
  }
  return null;
}

export function findNode(book: Book, id: string): TreeNode | null {
  return pathTo(book.children, id)?.node ?? null;
}

export function firstUnit(nodes: TreeNode[]): UnitNode | null {
  for (const n of nodes) {
    if (n.kind === 'unit') return n;
    const inner = firstUnit(n.children);
    if (inner) return inner;
  }
  return null;
}

const levelIdx = (book: Book, levelId: string) => book.structure.levels.findIndex((l) => l.id === levelId);

/**
 * Adds a new, empty unit: after the selected unit, at the end of the selected
 * container, or at the end of the book. Returns it.
 */
export function addUnit(book: Book, selectedId: string | null): UnitNode {
  const unit: UnitNode = { kind: 'unit', id: newId(), title: '' };
  const found = selectedId ? pathTo(book.children, selectedId) : null;
  if (found?.node.kind === 'unit') insertAfter(book, found.node.id, unit);
  else if (found?.node.kind === 'container') found.node.children.push(unit);
  else book.children.push(unit);
  return unit;
}

/**
 * Adds a new container of the given level (Part, Chapter…) containing one
 * empty unit, placed after whatever holds the current selection at that
 * depth. Returns the container and its unit.
 */
export function addContainer(book: Book, level: Level, selectedId: string | null): { container: ContainerNode; unit: UnitNode } {
  const idx = levelIdx(book, level.id);
  if (idx < 0 || idx === book.structure.levels.length - 1) throw new Error('That level holds text, not sections.');
  const unit: UnitNode = { kind: 'unit', id: newId(), title: '' };
  const container: ContainerNode = { kind: 'container', id: newId(), levelId: level.id, title: '', children: [unit] };

  const found = selectedId ? pathTo(book.children, selectedId) : null;
  const chain: TreeNode[] = found ? [...found.above, found.node] : [];
  // The deepest ancestor that may contain this level…
  let parentPos = -1;
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    if (n.kind === 'container' && levelIdx(book, n.levelId) < idx) {
      parentPos = i;
      break;
    }
  }
  // …and the node inside it that holds the selection: the new container goes right after that.
  const after = chain[parentPos + 1];
  if (after) insertAfter(book, after.id, container);
  else if (parentPos >= 0) (chain[parentPos] as ContainerNode).children.push(container);
  else book.children.push(container);
  return { container, unit };
}

/** Moves a node one place up or down among its siblings. Returns false at either end. */
export function nudge(book: Book, id: string, direction: -1 | 1): boolean {
  const found = pathTo(book.children, id);
  if (!found) return false;
  const list = found.above.length ? found.above[found.above.length - 1].children : book.children;
  const i = list.findIndex((n) => n.id === id);
  const j = i + direction;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

export function rename(book: Book, id: string, title: string): void {
  const node = findNode(book, id);
  if (!node) throw new Error('That item no longer exists.');
  node.title = title.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

/** Moves a unit or container into the book's trash list (kept on disk; nothing is deleted). */
export function removeToTrash(book: Book, trash: TreeNode[], id: string): void {
  trash.push(detach(book, id));
}

/** Binder label: "Chapter 27 · The Fall", or "27" when untitled. */
export function displayLabel(book: Book, node: TreeNode, numbers = numberTree(book)): string {
  const label = numbers.get(node.id)?.label ?? '';
  const title = node.title.trim();
  if (label && title) return `${label} · ${title}`;
  return label || title || 'Untitled';
}

export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Moves a node before, after or inside another node. Refuses (and changes
 * nothing) when the result would break the book's structure, e.g. a Section
 * inside a Chapter, or anything inside a microchapter.
 * Returns an explanation when refused, otherwise null.
 */
export function moveNode(book: Book, id: string, targetId: string, position: DropPosition): string | null {
  if (id === targetId) return null;
  const moving = pathTo(book.children, id);
  const target = pathTo(book.children, targetId);
  if (!moving || !target) return 'That item no longer exists.';
  if (moving.node.kind === 'container' && pathTo(moving.node.children, targetId)) {
    return 'A section can’t go inside itself.';
  }
  if (position === 'inside' && target.node.kind !== 'container') return 'Only sections can hold other items.';

  const before = JSON.stringify(book.children);
  const node = detach(book, id);
  if (position === 'inside') (target.node as ContainerNode).children.push(node);
  else {
    const list = pathTo(book.children, targetId)!.above.at(-1)?.children ?? book.children;
    const index = list.findIndex((n) => n.id === targetId);
    list.splice(position === 'before' ? index : index + 1, 0, node);
  }
  if (validateTree(book).length) {
    book.children = JSON.parse(before) as TreeNode[];
    const name = (n: TreeNode) =>
      n.kind === 'unit'
        ? book.structure.levels[book.structure.levels.length - 1].name
        : (book.structure.levels.find((l) => l.id === n.levelId)?.name ?? 'section');
    const into = position === 'inside' ? target.node : target.above.at(-1);
    return into ? `A ${name(moving.node)} can’t go inside a ${name(into)}.` : `A ${name(moving.node)} can’t go there.`;
  }
  return null;
}
