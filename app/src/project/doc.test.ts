import { describe, expect, it } from 'vitest';
import { countWords, emptyDoc, plainText, sanitizeDoc, toMarkdown } from './doc';

const para = (text: string, marks?: string[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }],
});

describe('sanitizeDoc', () => {
  it('keeps a normal document unchanged', () => {
    const doc = { type: 'doc', content: [para('Hello', ['bold']), { type: 'horizontalRule' }, para('World')] };
    expect(sanitizeDoc(doc)).toEqual(doc);
  });

  it('turns garbage into an empty document', () => {
    expect(sanitizeDoc(null)).toEqual(emptyDoc());
    expect(sanitizeDoc('nope')).toEqual(emptyDoc());
    expect(sanitizeDoc({ type: 'paragraph' })).toEqual(emptyDoc());
  });

  it('keeps the words inside unknown nodes and drops unknown marks and attributes', () => {
    const doc = sanitizeDoc({
      type: 'doc',
      content: [
        { type: 'iframe', attrs: { src: 'https://evil.example' }, content: [{ type: 'text', text: 'kept', marks: [{ type: 'link' }, { type: 'italic' }] }] },
      ],
    });
    expect(doc).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'italic' }] }] }] });
  });

  it('wraps stray text between blocks into a paragraph', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'text', text: 'loose' }] });
    expect(doc).toEqual({ type: 'doc', content: [para('loose')] });
  });

  it('limits heading levels', () => {
    const doc = sanitizeDoc({ type: 'doc', content: [{ type: 'heading', attrs: { level: 9 }, content: [{ type: 'text', text: 'H' }] }] });
    expect(doc.content?.[0].attrs).toEqual({ level: 2 });
  });
});

describe('words and text', () => {
  it('counts words the way writers do', () => {
    expect(countWords('')).toBe(0);
    expect(countWords("She didn't look back — well-worn boots, 27 steps.")).toBe(8);
    expect(countWords('Ünïcode wörds count')).toBe(3);
  });

  it('extracts plain text with blank lines between paragraphs', () => {
    expect(plainText({ type: 'doc', content: [para('One'), para('Two')] })).toBe('One\n\nTwo');
  });
});

describe('toMarkdown', () => {
  it('writes front matter, marks, scene breaks and escapes', () => {
    const md = toMarkdown(
      { type: 'doc', content: [para('Bold', ['bold']), { type: 'horizontalRule' }, para('a *star*')] },
      'The "Fall"',
    );
    expect(md).toBe('---\ntitle: "The \\"Fall\\""\n---\n\n**Bold**\n\n* * *\n\na \\*star\\*\n');
  });
});
