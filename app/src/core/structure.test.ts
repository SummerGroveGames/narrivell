import { describe, expect, it } from 'vitest';
import {
  type Book,
  type ContainerNode,
  type TreeNode,
  type UnitNode,
  formatNumber,
  moveAfter,
  numberTree,
  unitsInOrder,
  validateTree,
} from './structure';
import { FICTION_PRESETS, NONFICTION_PRESET } from './templates';

const unit = (id: string): UnitNode => ({ kind: 'unit', id, title: '' });
const box = (id: string, levelId: string, children: TreeNode[]): ContainerNode => ({
  kind: 'container',
  id,
  levelId,
  title: '',
  children,
});
const preset = (id: string) => FICTION_PRESETS.find((p) => p.id === id)!.levels;

describe('formatNumber', () => {
  it('formats every style', () => {
    expect(formatNumber(4, 'arabic')).toBe('4');
    expect(formatNumber(4, 'upper-roman')).toBe('IV');
    expect(formatNumber(14, 'lower-roman')).toBe('xiv');
    expect(formatNumber(1994, 'upper-roman')).toBe('MCMXCIV');
    expect(formatNumber(21, 'words')).toBe('Twenty-One');
    expect(formatNumber(115, 'words')).toBe('One Hundred and Fifteen');
    expect(formatNumber(3, 'none')).toBe('');
  });
  it('falls back to digits outside a style’s range', () => {
    expect(formatNumber(4000, 'upper-roman')).toBe('4000');
    expect(formatNumber(1000, 'words')).toBe('1000');
  });
  it('rejects zero and fractions', () => {
    expect(() => formatNumber(0, 'arabic')).toThrow();
    expect(() => formatNumber(1.5, 'arabic')).toThrow();
  });
});

describe('numberTree', () => {
  it('numbers sequences with microchapters continuing through the book (the author’s structure)', () => {
    const book: Book = {
      structure: { levels: preset('sequences-microchapters') },
      children: [
        box('s1', 'sequence', [unit('m1'), unit('m2')]),
        box('s2', 'sequence', [unit('m3')]),
        box('s4', 'sequence', [unit('m4'), unit('m5')]),
      ],
    };
    const n = numberTree(book);
    expect(n.get('s1')!.label).toBe('Sequence I');
    expect(n.get('s4')!.label).toBe('Sequence III');
    expect(n.get('m3')!.label).toBe('3');
    expect(n.get('m5')!.label).toBe('5');
  });

  it('allows the optional chapter level to be used in some places only', () => {
    const book: Book = {
      structure: { levels: preset('sequences-microchapters') },
      children: [box('s1', 'sequence', [box('c1', 'chapter', [unit('m1'), unit('m2')]), unit('m3')])],
    };
    expect(validateTree(book)).toEqual([]);
    const n = numberTree(book);
    expect(n.get('c1')!.label).toBe('Chapter 1');
    expect(n.get('m3')!.label).toBe('3');
  });

  it('restarts and compounds section numbers inside chapters (27.i, 27.ii)', () => {
    const chapters = Array.from({ length: 27 }, (_, i) => box(`c${i + 1}`, 'chapter', [unit(`u${i + 1}a`)]));
    chapters[26].children.push(unit('u27b'));
    const book: Book = { structure: { levels: preset('chapters-sections') }, children: chapters };
    const n = numberTree(book);
    expect(n.get('c27')!.label).toBe('Chapter 27');
    expect(n.get('u27a')!.label).toBe('27.i');
    expect(n.get('u27b')!.label).toBe('27.ii');
    expect(n.get('u1a')!.label).toBe('1.i');
  });

  it('leaves unnumbered levels without a number', () => {
    const book: Book = {
      structure: { levels: NONFICTION_PRESET.levels },
      children: [box('p1', 'part', [box('c1', 'chapter', [unit('s1')])])],
    };
    const n = numberTree(book);
    expect(n.get('p1')!.label).toBe('Part I');
    expect(n.get('s1')!.label).toBe('');
  });
});

describe('validateTree', () => {
  const levels = preset('sequences-microchapters');
  it('rejects a level inside a deeper level', () => {
    const book: Book = { structure: { levels }, children: [box('c1', 'chapter', [box('s1', 'sequence', [])])] };
    expect(validateTree(book).length).toBeGreaterThan(0);
  });
  it('rejects duplicate ids and unknown levels', () => {
    const book: Book = { structure: { levels }, children: [unit('a'), unit('a'), box('x', 'nope', [])] };
    expect(validateTree(book).length).toBe(2);
  });
});

describe('restructuring', () => {
  it('moves units without touching anything else', () => {
    const book: Book = {
      structure: { levels: preset('sequences-microchapters') },
      children: [box('s1', 'sequence', [unit('m1'), unit('m2')]), box('s2', 'sequence', [unit('m3')])],
    };
    moveAfter(book, 'm1', 'm3');
    expect(unitsInOrder(book).map((u) => u.unit.id)).toEqual(['m2', 'm3', 'm1']);
    expect(numberTree(book).get('m1')!.label).toBe('3');
  });
  it('refuses to move a section inside itself', () => {
    const book: Book = {
      structure: { levels: preset('sequences-microchapters') },
      children: [box('s1', 'sequence', [box('c1', 'chapter', [unit('m1')])])],
    };
    expect(() => moveAfter(book, 's1', 'm1')).toThrow();
  });
});
