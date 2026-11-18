import { describe, expect, it } from 'vitest';
import type { Book, ContainerNode } from '../core/structure';
import { validateTree } from '../core/structure';
import { fictionSettings } from '../core/templates';
import { addContainer, addUnit, displayLabel, firstUnit, nudge, pathTo, rename } from './tree';

function microBook(): Book {
  return { structure: { levels: fictionSettings('sections-microchapters').levels }, children: [] };
}
const level = (book: Book, id: string) => book.structure.levels.find((l) => l.id === id)!;

describe('binder operations', () => {
  it('adds units after the selection and inside a selected container', () => {
    const book = microBook();
    const { container, unit } = addContainer(book, level(book, 'section'), null);
    const second = addUnit(book, unit.id);
    expect(container.children.map((n) => n.id)).toEqual([unit.id, second.id]);
    const third = addUnit(book, container.id);
    expect(container.children[2].id).toBe(third.id);
    expect(validateTree(book)).toEqual([]);
  });

  it('nests a new chapter inside the selected section, and a new section at the top level', () => {
    const book = microBook();
    const s1 = addContainer(book, level(book, 'section'), null);
    const ch = addContainer(book, level(book, 'chapter'), s1.unit.id);
    expect(s1.container.children[1].id).toBe(ch.container.id);
    const s2 = addContainer(book, level(book, 'section'), ch.unit.id);
    expect(book.children.map((n) => n.id)).toEqual([s1.container.id, s2.container.id]);
    expect(validateTree(book)).toEqual([]);
  });

  it('refuses to make a container on the text level', () => {
    const book = microBook();
    expect(() => addContainer(book, level(book, 'microchapter'), null)).toThrow();
  });

  it('numbers microchapters continuously across sections', () => {
    const book = microBook();
    const s1 = addContainer(book, level(book, 'section'), null);
    addUnit(book, s1.unit.id);
    const s2 = addContainer(book, level(book, 'section'), s1.unit.id);
    rename(book, s2.unit.id, 'The Fall');
    expect(displayLabel(book, s2.container)).toBe('Section II');
    expect(displayLabel(book, s2.unit)).toBe('3 · The Fall');
  });

  it('moves items among siblings and stops at the ends', () => {
    const book = microBook();
    const a = addUnit(book, null);
    const b = addUnit(book, a.id);
    expect(nudge(book, b.id, -1)).toBe(true);
    expect(book.children.map((n) => n.id)).toEqual([b.id, a.id]);
    expect(nudge(book, b.id, -1)).toBe(false);
  });

  it('finds paths and the first unit', () => {
    const book = microBook();
    const s = addContainer(book, level(book, 'section'), null);
    const ch = addContainer(book, level(book, 'chapter'), s.unit.id);
    expect(pathTo(book.children, ch.unit.id)!.above.map((c: ContainerNode) => c.id)).toEqual([s.container.id, ch.container.id]);
    expect(firstUnit(book.children)!.id).toBe(s.unit.id);
  });
});

describe('drag and drop', () => {
  it('moves a unit into another section and between units', async () => {
    const { moveNode } = await import('./tree');
    const book = microBook();
    const s1 = addContainer(book, level(book, 'section'), null);
    const s2 = addContainer(book, level(book, 'section'), s1.unit.id);
    expect(moveNode(book, s1.unit.id, s2.unit.id, 'after')).toBe(null);
    expect(s2.container.children.map((n) => n.id)).toEqual([s2.unit.id, s1.unit.id]);
    expect(moveNode(book, s1.unit.id, s2.unit.id, 'before')).toBe(null);
    expect(s2.container.children[0].id).toBe(s1.unit.id);
  });

  it('refuses moves that break the structure and leaves the book unchanged', async () => {
    const { moveNode } = await import('./tree');
    const book = microBook();
    const s1 = addContainer(book, level(book, 'section'), null);
    const ch = addContainer(book, level(book, 'chapter'), s1.unit.id);
    const snapshot = JSON.stringify(book.children);
    expect(moveNode(book, s1.container.id, ch.container.id, 'inside')).toContain('itself');
    const s2 = addContainer(book, level(book, 'section'), null);
    const before2 = JSON.stringify(book.children);
    expect(moveNode(book, s2.container.id, ch.container.id, 'inside')).toBe('A Section can’t go inside a Chapter.');
    expect(JSON.stringify(book.children)).toBe(before2);
    expect(moveNode(book, ch.unit.id, s1.unit.id, 'inside')).toContain('Only sections');
    expect(snapshot.length).toBeGreaterThan(0);
  });
});
