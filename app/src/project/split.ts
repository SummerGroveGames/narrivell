/** Splitting and merging units' text. Words are only divided or joined, never changed. */
import type { DocNode } from './doc';
import { emptyDoc } from './doc';

/** Splits a document before each of the given top-level block indexes (ascending). */
export function splitAtBlocks(doc: DocNode, at: number[]): DocNode[] {
  const blocks = doc.content ?? [];
  const cuts = [...new Set(at)].filter((i) => i > 0 && i < blocks.length).sort((a, b) => a - b);
  const out: DocNode[] = [];
  let start = 0;
  for (const cut of [...cuts, blocks.length]) {
    const part = blocks.slice(start, cut);
    // A scene-break mark at the start of a new part has done its job.
    while (part.length > 1 && part[0].type === 'horizontalRule') part.shift();
    out.push(part.length ? { type: 'doc', content: part } : emptyDoc());
    start = cut;
  }
  return out;
}

/** Joins two documents; a scene break marks where they met. */
export function mergeDocs(a: DocNode, b: DocNode): DocNode {
  const isEmpty = (d: DocNode) => !(d.content ?? []).some((n) => n.type !== 'paragraph' || (n.content ?? []).length);
  if (isEmpty(a)) return b;
  if (isEmpty(b)) return a;
  return { type: 'doc', content: [...(a.content ?? []), { type: 'horizontalRule' }, ...(b.content ?? [])] };
}
