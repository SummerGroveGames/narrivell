import { describe, expect, it } from 'vitest';
import { validateTree, numberTree } from '../core/structure';
import { fictionSettings } from '../core/templates';
import { analyse, assignLevels, build } from './breaks';
import { parseDocumentXml, readDocx, type WordParagraph } from './docx';
import { ZIP_LIMITS } from './zip';

// --- helpers ---------------------------------------------------------------

/** Makes a tiny .docx (stored or deflated zip) in memory. */
async function makeDocx(files: Record<string, string>, deflate = false): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    let data = raw;
    if (deflate) {
      const s = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      data = new Uint8Array(await new Response(s).arrayBuffer());
    }
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, deflate ? 8 : 0, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, raw.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of all) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const doc = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
const p = (text: string, ppr = '', rpr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const para = (text: string, extra: Partial<WordParagraph> = {}): WordParagraph => ({
  runs: [{ text }],
  text,
  style: '',
  headingLevel: null,
  align: '',
  color: null,
  size: null,
  ...extra,
});
const levels = fictionSettings('sections-microchapters').levels;

// --- reading .docx -----------------------------------------------------------

describe('reading Word files', () => {
  it('reads paragraphs, emphasis, line breaks and heading styles (stored and compressed)', async () => {
    const styles = `<w:styles ${W}><w:style w:styleId="Heading3"><w:name w:val="heading 3"/></w:style></w:styles>`;
    const body = doc(
      p('2—The Chamber', '<w:pStyle w:val="Heading3"/>') +
        `<w:p><w:r><w:t>Plain </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>slanted</w:t></w:r><w:r><w:br/><w:t>next line &amp; more</w:t></w:r></w:p>` +
        `<w:p><w:del><w:r><w:delText>gone</w:delText></w:r></w:del><w:r><w:instrText>PAGE</w:instrText></w:r><w:r><w:t>kept</w:t></w:r></w:p>`,
    );
    for (const deflate of [false, true]) {
      const paras = await readDocx(await makeDocx({ 'word/document.xml': body, 'word/styles.xml': styles }, deflate));
      expect(paras.length).toBe(3);
      expect(paras[0].headingLevel).toBe(3);
      expect(paras[1].runs).toEqual([{ text: 'Plain ' }, { text: 'slanted', italic: true }, { text: '\nnext line & more' }]);
      expect(paras[2].text).toBe('kept');
    }
  });

  it('notes heading colour and size', () => {
    const [q] = parseDocumentXml(doc(p('27 — The Island', '', '<w:color w:val="0f4761"/><w:sz w:val="32"/>')));
    expect(q.color).toBe('0F4761');
    expect(q.size).toBe(16);
  });

  it('refuses files that are not Word documents or are unsafe', async () => {
    let msg = '';
    await readDocx(new TextEncoder().encode('hello')).catch((e: Error) => (msg = e.message));
    expect(msg).toContain('Word');
    msg = '';
    await readDocx(await makeDocx({ 'word/document.xml': '<!DOCTYPE x [<!ENTITY a "b">]><x/>' })).catch((e: Error) => (msg = e.message));
    expect(msg).toContain('refuses');
    msg = '';
    await readDocx(await makeDocx({ 'other.xml': '<x/>' })).catch((e: Error) => (msg = e.message));
    expect(msg).toContain('no document');
  });

  it('stops decompressing past the size limit', async () => {
    const saved = ZIP_LIMITS.entryBytes;
    ZIP_LIMITS.entryBytes = 1000;
    let msg = '';
    try {
      await readDocx(await makeDocx({ 'word/document.xml': doc(p('x'.repeat(5000))) }, true)).catch((e: Error) => (msg = e.message));
    } finally {
      ZIP_LIMITS.entryBytes = saved;
    }
    expect(msg.length).toBeGreaterThan(0);
  });
});

// --- finding breaks -------------------------------------------------------------

describe('finding breaks', () => {
  it('finds sequence, chapter, prologue and scene breaks, and drops empty lines', () => {
    const a = analyse([
      para('PROLOGUE', { headingLevel: 2, style: 'heading 2' }),
      para('Before it all.'),
      para('SEQUENCE I', { headingLevel: 2 }),
      para(''),
      para('1—Routine in the Dark'),
      para('Text one.'),
      para('—'),
      para('Text two.'),
      para('2 — The Chamber', { color: '0F4761' }),
      para('Text three.'),
    ]);
    expect(a.stats.emptyRemoved).toBe(1);
    expect(a.breaks.map((b) => [b.role, b.title, b.confidence])).toEqual([
      ['special', 'Prologue', 'certain'],
      ['top', '', 'certain'],
      ['chapter', 'Routine in the Dark', 'likely'],
      ['scene', '', 'likely'],
      ['chapter', 'The Chamber', 'certain'],
    ]);
    expect(a.breaks[1].word).toBe('Sequence');
  });

  it('splits a heading that was merged with the first line of text', () => {
    const a = analyse([para('23 — Crete\nCrete did not arrive the way Menorca had.', { color: '0F4761' })]);
    expect(a.blocks.map((b) => b.kind)).toEqual(['heading', 'text']);
    expect(a.breaks[0].title).toBe('Crete');
    expect(a.blocks[1].text).toBe('Crete did not arrive the way Menorca had.');
  });

  it('does not mistake times, list numbers or out-of-order numbers for chapters', () => {
    const a = analyse([
      para('11 — Quarantine', { color: '0F4761' }),
      para('08:00–09:30 — Dr. Scott — calibration'),
      para('07.', { runs: [{ text: '07.', bold: true }] }),
      para('8 — a list item'),
      para('12 — The Pressure Valve', { color: '0F4761' }),
    ]);
    const chapters = a.breaks.filter((b) => b.confidence !== 'possible');
    expect(chapters.map((b) => b.fileNumber)).toEqual([11, 12]);
  });

  it('offers three or more empty lines as a possible break, off by default', () => {
    const a = analyse([para('One.'), para(''), para(''), para(''), para('Two.')]);
    const [b] = assignLevels(a.breaks, levels);
    expect(b.confidence).toBe('possible');
    expect(b.level).toBe(null);
  });
});

// --- building the book --------------------------------------------------------

describe('building binder items', () => {
  const sample = () =>
    analyse([
      para('PROLOGUE', { headingLevel: 2 }),
      para('Before.'),
      para('SEQUENCE I', { headingLevel: 2 }),
      para('1 — First', { color: '0F4761' }),
      para('Alpha', { runs: [{ text: 'Alpha', italic: true }] }),
      para('—'),
      para('Beta'),
      para('2 — Second', { color: '0F4761' }),
      para('Gamma'),
    ]);

  it('builds a valid tree with an unnumbered prologue and continuous numbering', () => {
    const a = sample();
    const { nodes, docs } = build(a.blocks, assignLevels(a.breaks, levels), levels, 'emphasis');
    const book = { structure: { levels }, children: nodes };
    expect(validateTree(book)).toEqual([]);
    const labels = numberTree(book);
    const [prologue, seq] = nodes;
    expect(prologue.kind === 'container' && prologue.unnumbered).toBe(true);
    expect(labels.get(seq.id)?.label).toBe('Section I');
    if (seq.kind !== 'container') throw new Error('expected a section');
    expect(seq.children.map((c) => labels.get(c.id)?.label)).toEqual(['Chapter 1', 'Chapter 2']);
    const ch1 = seq.children[0];
    if (ch1.kind !== 'container') throw new Error('expected a chapter');
    expect(ch1.children.length).toBe(2); // split at the scene mark
    expect(docs.get(ch1.children[0].id)).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha', marks: [{ type: 'italic' }] }] }],
    });
  });

  it('keeps dismissed breaks in the text and strips emphasis in plain mode', () => {
    const a = sample();
    const breaks = assignLevels(a.breaks, levels).map((b) => (b.role === 'scene' ? { ...b, level: null } : b));
    const { nodes, docs } = build(a.blocks, breaks, levels, 'plain');
    const seq = nodes[1];
    if (seq.kind !== 'container' || seq.children[0].kind !== 'container') throw new Error('shape');
    const unit = seq.children[0].children[0];
    expect(docs.get(unit.id)!.content!.map((n) => n.type)).toEqual(['paragraph', 'horizontalRule', 'paragraph']);
    expect(JSON.stringify(docs.get(unit.id))).not.toContain('italic');
  });
});
