import { describe, expect, it } from 'vitest';
import type { DocNode } from '../project/doc';
import { mergeDocs, splitAtBlocks } from '../project/split';
import { suggestBreaks } from './rules';

const words = (n: number, end = '.') => `${Array.from({ length: n }, (_, i) => `word${i}`).join(' ')}${end}`;
const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const target = { min: 1000, max: 2000 };

describe('built-in microchapter suggestions', () => {
  it('suggests nothing for a chapter already within the target', () => {
    const plan = suggestBreaks(doc(...Array.from({ length: 15 }, () => p(words(100)))), target);
    expect(plan.suggestions).toEqual([]);
    expect(plan.lengths).toEqual([1500]);
  });

  it('prefers a scene mark and a time jump at sensible lengths', () => {
    const blocks: DocNode[] = [];
    for (let i = 0; i < 15; i++) blocks.push(p(words(100)));
    blocks.push(p('It was gone.'));
    blocks.push({ type: 'horizontalRule' });
    for (let i = 0; i < 14; i++) blocks.push(p(words(100)));
    blocks.push(p('By morning the lab was full of people.'));
    for (let i = 0; i < 15; i++) blocks.push(p(words(100)));
    const plan = suggestBreaks(doc(...blocks), target);
    expect(plan.suggestions.map((s) => s.at)).toEqual([16, 31]);
    expect(plan.suggestions[0].strength).toBe('strong');
    expect(plan.suggestions[0].reasons).toContain('Scene-break mark');
    expect(plan.suggestions[1].reasons.join(' ')).toContain('Time jump');
    expect(plan.lengths.every((n) => n >= 1000 && n <= 2000)).toBe(true);
  });

  it('still divides a very long chapter with no signals, so nothing is left far over target', () => {
    const plan = suggestBreaks(doc(...Array.from({ length: 60 }, (_, i) => p(words(100, i % 7 === 6 ? '?' : '.')))), target);
    expect(plan.lengths.every((n) => n <= 2100)).toBe(true);
    expect(plan.suggestions.length).toBeGreaterThan(1);
  });
});

describe('split and merge', () => {
  it('splits at blocks and drops a leading scene mark', () => {
    const parts = splitAtBlocks(doc(p('a'), p('b'), { type: 'horizontalRule' }, p('c')), [2]);
    expect(parts).toEqual([doc(p('a'), p('b')), doc(p('c'))]);
  });

  it('merges with a scene break between, and ignores empty halves', () => {
    expect(mergeDocs(doc(p('a')), doc(p('b')))).toEqual(doc(p('a'), { type: 'horizontalRule' }, p('b')));
    expect(mergeDocs(doc({ type: 'paragraph' }), doc(p('b')))).toEqual(doc(p('b')));
  });
});
