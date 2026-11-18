/**
 * Reads the text of a Word .docx file: paragraphs, emphasis, line breaks,
 * and the clues Narrivell uses to find headings (styles, colour, size,
 * alignment). Deleted tracked changes and field instructions are skipped.
 */
import { tokenize } from './xml';
import { ImportError, readZipEntries } from './zip';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface WordParagraph {
  runs: Run[];
  /** Plain text of the paragraph ("\n" for line breaks inside it). */
  text: string;
  style: string;
  /** 1–9 when the paragraph uses a Heading style or Title (0). */
  headingLevel: number | null;
  align: string;
  /** Text colour used by most of the paragraph's characters (hex), if any. */
  color: string | null;
  /** Largest font size used, in points. */
  size: number | null;
}

const MAX_PARAGRAPHS = 200_000;
const truthy = (v: string | undefined) => v === undefined || !['0', 'false', 'off', 'none'].includes(v);

function readStyles(xml: string | null): Map<string, { name: string; basedOn?: string }> {
  const styles = new Map<string, { name: string; basedOn?: string }>();
  if (!xml) return styles;
  let current: string | null = null;
  for (const e of tokenize(xml)) {
    if (e.type !== 'open') continue;
    if (e.name === 'w:style') {
      current = e.attrs['w:styleId'] ?? null;
      if (current) styles.set(current, { name: current });
    } else if (current && e.name === 'w:name') styles.get(current)!.name = e.attrs['w:val'] ?? current;
    else if (current && e.name === 'w:basedOn') styles.get(current)!.basedOn = e.attrs['w:val'];
  }
  return styles;
}

function headingLevel(styleId: string, styles: Map<string, { name: string; basedOn?: string }>): number | null {
  let id: string | undefined = styleId;
  for (let hops = 0; id && hops < 10; hops++) {
    const s = styles.get(id);
    const name = (s?.name ?? id).toLowerCase();
    if (name === 'title') return 0;
    const m = /^heading\s*([1-9])$/.exec(name);
    if (m) return Number(m[1]);
    id = s?.basedOn;
  }
  return null;
}

export async function readDocx(bytes: Uint8Array): Promise<WordParagraph[]> {
  const parts = await readZipEntries(bytes, ['word/document.xml', 'word/styles.xml']);
  const doc = parts.get('word/document.xml');
  if (!doc) throw new ImportError('This isn’t a Word (.docx) file – it has no document inside.');
  const decoder = new TextDecoder('utf-8');
  const styles = readStyles(parts.has('word/styles.xml') ? decoder.decode(parts.get('word/styles.xml')) : null);
  return parseDocumentXml(decoder.decode(doc), styles);
}

interface Building {
  runs: Run[];
  styleId: string;
  align: string;
  colorChars: Map<string, number>;
  size: number;
}

export function parseDocumentXml(xml: string, styles = new Map<string, { name: string; basedOn?: string }>()): WordParagraph[] {
  const out: WordParagraph[] = [];
  const stack: Building[] = [];
  let inPPr = 0;
  let inRPr = 0;
  let skip = 0; // inside w:del, w:instrText, footnote-like parts we ignore
  let inText = false;
  let run: { bold: boolean; italic: boolean; underline: boolean; strike: boolean; color: string | null; size: number } | null = null;

  const push = (text: string) => {
    const p = stack[stack.length - 1];
    if (!p || !run || !text) return;
    const last = p.runs[p.runs.length - 1];
    const fmt = { bold: run.bold, italic: run.italic, underline: run.underline, strike: run.strike };
    if (last && !!last.bold === fmt.bold && !!last.italic === fmt.italic && !!last.underline === fmt.underline && !!last.strike === fmt.strike) {
      last.text += text;
    } else {
      const r: Run = { text };
      if (fmt.bold) r.bold = true;
      if (fmt.italic) r.italic = true;
      if (fmt.underline) r.underline = true;
      if (fmt.strike) r.strike = true;
      p.runs.push(r);
    }
    if (run.color && text.trim()) p.colorChars.set(run.color, (p.colorChars.get(run.color) ?? 0) + text.length);
    if (run.size && text.trim()) p.size = Math.max(p.size, run.size);
  };

  for (const e of tokenize(xml)) {
    if (e.type === 'text') {
      if (inText && !skip) push(e.text);
      continue;
    }
    const name = e.name;
    if (e.type === 'close') {
      if (name === 'w:p') {
        const p = stack.pop();
        if (p) {
          if (out.length >= MAX_PARAGRAPHS) throw new ImportError('This document is too long to import in one go.');
          let color: string | null = null;
          let best = 0;
          for (const [c, n] of p.colorChars) if (n > best) [color, best] = [c, n];
          out.push({
            runs: p.runs,
            text: p.runs.map((r) => r.text).join(''),
            style: styles.get(p.styleId)?.name ?? p.styleId,
            headingLevel: p.styleId ? headingLevel(p.styleId, styles) : null,
            align: p.align,
            color,
            size: p.size ? p.size / 2 : null,
          });
        }
      } else if (name === 'w:pPr') inPPr = Math.max(0, inPPr - 1);
      else if (name === 'w:rPr') inRPr = Math.max(0, inRPr - 1);
      else if (name === 'w:r') run = null;
      else if (name === 'w:t') inText = false;
      else if (name === 'w:del' || name === 'w:instrText' || name === 'w:delText' || name === 'w:moveFrom') skip = Math.max(0, skip - 1);
      continue;
    }
    // open
    switch (name) {
      case 'w:p':
        stack.push({ runs: [], styleId: '', align: '', colorChars: new Map(), size: 0 });
        break;
      case 'w:pPr':
        inPPr++;
        break;
      case 'w:pStyle':
        if (inPPr && !inRPr && stack.length) stack[stack.length - 1].styleId = e.attrs['w:val'] ?? '';
        break;
      case 'w:jc':
        if (inPPr && !inRPr && stack.length) stack[stack.length - 1].align = e.attrs['w:val'] ?? '';
        break;
      case 'w:r':
        run = { bold: false, italic: false, underline: false, strike: false, color: null, size: 0 };
        break;
      case 'w:rPr':
        inRPr++;
        break;
      case 'w:b':
        if (run && inRPr && !inPPr) run.bold = truthy(e.attrs['w:val']);
        break;
      case 'w:i':
        if (run && inRPr && !inPPr) run.italic = truthy(e.attrs['w:val']);
        break;
      case 'w:u':
        if (run && inRPr && !inPPr) run.underline = truthy(e.attrs['w:val']);
        break;
      case 'w:strike':
      case 'w:dstrike':
        if (run && inRPr && !inPPr) run.strike = truthy(e.attrs['w:val']);
        break;
      case 'w:color':
        if (run && inRPr && !inPPr) {
          const v = e.attrs['w:val'];
          run.color = v && /^[0-9a-fA-F]{6}$/.test(v) && v !== '000000' ? v.toUpperCase() : null;
        }
        break;
      case 'w:sz':
        if (run && inRPr && !inPPr) run.size = Number(e.attrs['w:val']) || 0;
        break;
      case 'w:t':
        inText = !e.selfClosing;
        break;
      case 'w:tab':
        if (run && !inPPr && !skip) push('\t');
        break;
      case 'w:br':
        if (run && !skip && (!e.attrs['w:type'] || e.attrs['w:type'] === 'textWrapping')) push('\n');
        break;
      case 'w:cr':
        if (run && !skip) push('\n');
        break;
      case 'w:noBreakHyphen':
        if (run && !skip) push('‑');
        break;
      case 'w:del':
      case 'w:instrText':
      case 'w:delText':
      case 'w:moveFrom':
        skip++; // a self-closing tag is followed by its own close event
        break;
    }
  }
  return out;
}
