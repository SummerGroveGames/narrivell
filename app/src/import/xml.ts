/**
 * A minimal streaming XML tokenizer for Word's document parts. It never
 * fetches or expands anything: no DTDs (refused), no external entities,
 * only the five standard entities and numeric character references.
 */
import { ImportError } from './zip';

export type XmlEvent =
  | { type: 'open'; name: string; attrs: Record<string, string>; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[body] ?? whole;
  });
}

const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function* tokenize(xml: string): Generator<XmlEvent> {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      const text = xml.slice(i);
      if (text) yield { type: 'text', text: decodeEntities(text) };
      return;
    }
    if (lt > i) yield { type: 'text', text: decodeEntities(xml.slice(i, lt)) };
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      yield { type: 'text', text: xml.slice(lt + 9, end < 0 ? n : end) };
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (xml.startsWith('<!', lt)) throw new ImportError('This file contains a document type declaration, which Narrivell refuses for safety.');
    if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) throw new ImportError('This file is damaged (unfinished XML).');
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') {
      yield { type: 'close', name: raw.slice(1).trim() };
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const space = body.search(/\s/);
    const name = space < 0 ? body : body.slice(0, space);
    const attrs: Record<string, string> = {};
    if (space >= 0) {
      ATTR.lastIndex = 0;
      let m: RegExpExecArray | null;
      const rest = body.slice(space);
      while ((m = ATTR.exec(rest))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    yield { type: 'open', name, attrs, selfClosing };
    if (selfClosing) yield { type: 'close', name };
  }
}
