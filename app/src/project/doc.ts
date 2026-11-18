/**
 * The text of one unit, stored as editor JSON (ProseMirror/TipTap shape),
 * plus helpers that don't need the editor: cleaning untrusted files, word
 * counts and a Markdown copy.
 *
 * Unit files come from disk, possibly via a sync service, so they are
 * cleaned before reaching the editor: unknown node types become plain
 * paragraphs (their text is kept), unknown marks and attributes are
 * dropped, and sizes are bounded.
 */

export interface Mark {
  type: string;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Mark[];
}

const BLOCKS = new Set([
  'doc', 'paragraph', 'heading', 'blockquote', 'horizontalRule', 'bulletList', 'orderedList', 'listItem', 'hardBreak', 'text',
]);
const MARKS = new Set(['bold', 'italic', 'strike', 'underline', 'code']);
const LIMITS = { depth: 12, nodes: 200_000, text: 2_000_000 };

export function emptyDoc(): DocNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Cleans editor JSON from disk. Never throws; keeps every word it can find. */
export function sanitizeDoc(raw: unknown): DocNode {
  const budget = { nodes: 0, text: 0 };

  const clean = (v: unknown, depth: number): DocNode | null => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    if (++budget.nodes > LIMITS.nodes || depth > LIMITS.depth) return null;
    const n = v as Record<string, unknown>;
    let type = typeof n.type === 'string' && BLOCKS.has(n.type) ? n.type : 'paragraph';

    if (type === 'text') {
      if (typeof n.text !== 'string' || n.text.length === 0) return null;
      budget.text += n.text.length;
      if (budget.text > LIMITS.text) return null;
      const out: DocNode = { type: 'text', text: n.text };
      if (Array.isArray(n.marks)) {
        const marks = n.marks
          .map((m) => (typeof m === 'object' && m && typeof (m as Mark).type === 'string' ? (m as Mark).type : ''))
          .filter((t, i, all) => MARKS.has(t) && all.indexOf(t) === i)
          .map((t) => ({ type: t }));
        if (marks.length) out.marks = marks;
      }
      return out;
    }
    if (type === 'doc' && depth > 0) type = 'paragraph';

    const out: DocNode = { type };
    if (type === 'heading') {
      const level = (n.attrs as Record<string, unknown> | undefined)?.level;
      out.attrs = { level: Number.isInteger(level) && (level as number) >= 1 && (level as number) <= 3 ? level : 2 };
    }
    if (type === 'orderedList') {
      const start = (n.attrs as Record<string, unknown> | undefined)?.start;
      out.attrs = { start: Number.isInteger(start) && (start as number) > 0 ? start : 1 };
    }
    if (Array.isArray(n.content) && type !== 'horizontalRule' && type !== 'hardBreak') {
      const children = n.content.map((c) => clean(c, depth + 1)).filter((c): c is DocNode => c !== null);
      if (children.length) out.content = inline(type) ? children : blocksOnly(children);
    }
    return out;
  };

  const root = clean(raw, 0);
  if (!root || root.type !== 'doc') return emptyDoc();
  if (!root.content?.length) root.content = [{ type: 'paragraph' }];
  return root;
}

/** Node types whose children are inline (text and line breaks). */
const inline = (type: string) => type === 'paragraph' || type === 'heading';

/** Wraps stray text that ended up between blocks into paragraphs, so the editor accepts it. */
function blocksOnly(children: DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  let pending: DocNode[] = [];
  const flush = () => {
    if (pending.length) out.push({ type: 'paragraph', content: pending });
    pending = [];
  };
  for (const c of children) {
    if (c.type === 'text' || c.type === 'hardBreak') pending.push(c);
    else {
      flush();
      out.push(c);
    }
  }
  flush();
  return out;
}

/** Plain text, with blocks separated by blank lines. */
export function plainText(doc: DocNode): string {
  const blocks: string[] = [];
  const inlineText = (n: DocNode): string =>
    n.type === 'text' ? (n.text ?? '') : n.type === 'hardBreak' ? '\n' : (n.content ?? []).map(inlineText).join('');
  const visit = (n: DocNode) => {
    if (inline(n.type)) blocks.push(inlineText(n));
    else (n.content ?? []).forEach(visit);
  };
  visit(doc);
  return blocks.join('\n\n');
}

/** Words as a writer would count them: letters/digits joined by apostrophes or hyphens count as one. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

// ---------------------------------------------------------------------------
// Markdown copy: a readable, future-proof copy of each unit next to the JSON,
// so the text is never locked inside Narrivell.
// ---------------------------------------------------------------------------

const escapeMd = (s: string) => s.replace(/([\\`*_[\]#<>])/g, '\\$1');

function inlineMd(nodes: DocNode[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n';
      let t = escapeMd(n.text ?? '');
      const marks = new Set((n.marks ?? []).map((m) => m.type));
      if (!t.trim()) return t;
      if (marks.has('code')) t = `\`${n.text}\``;
      if (marks.has('bold')) t = `**${t}**`;
      if (marks.has('italic')) t = `*${t}*`;
      if (marks.has('strike')) t = `~~${t}~~`;
      return t;
    })
    .join('');
}

function blockMd(node: DocNode, indent = ''): string[] {
  switch (node.type) {
    case 'paragraph':
      return [indent + inlineMd(node.content)];
    case 'heading':
      return [`${indent}${'#'.repeat(Number(node.attrs?.level) || 2)} ${inlineMd(node.content)}`];
    case 'horizontalRule':
      return [`${indent}* * *`];
    case 'blockquote':
      return (node.content ?? []).flatMap((c) => blockMd(c, `${indent}> `));
    case 'bulletList':
    case 'orderedList': {
      let i = Number(node.attrs?.start) || 1;
      return (node.content ?? []).map((item) => {
        const marker = node.type === 'bulletList' ? '- ' : `${i++}. `;
        const lines = (item.content ?? []).flatMap((c) => blockMd(c));
        return indent + marker + lines.join(`\n${indent}   `);
      });
    }
    default:
      return (node.content ?? []).flatMap((c) => blockMd(c, indent));
  }
}

export function toMarkdown(doc: DocNode, title: string): string {
  const body = (doc.content ?? []).flatMap((n) => blockMd(n)).join('\n\n');
  const safeTitle = title.replace(/[\r\n]/g, ' ').replace(/"/g, '\\"');
  return `---\ntitle: "${safeTitle}"\n---\n\n${body.trim()}\n`;
}
