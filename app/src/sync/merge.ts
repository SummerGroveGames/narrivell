/**
 * Three-way merges for when the same file changed on two devices since they
 * last synced. "base" is the version both devices last agreed on.
 * Nothing is ever thrown away: where both sides changed the same passage,
 * both versions are kept, one after the other, with a note to choose.
 */
import type { ProjectFile } from '../core/projectFile';
import type { ContainerNode, TreeNode } from '../core/structure';
import { validateTree } from '../core/structure';
import type { DocNode } from '../project/doc';

// ---------------------------------------------------------------------------
// Text: paragraph-level diff3
// ---------------------------------------------------------------------------

/** Longest-common-subsequence matches between two lists of keys: map from a-index to b-index. */
function matches(a: string[], b: string[]): Map<number, number> {
  const n = a.length;
  const m = b.length;
  // Trim the common start and end first: usually most of a chapter.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const out = new Map<number, number>();
  for (let i = 0; i < start; i++) out.set(i, i);
  for (let k = 0; k < n - endA; k++) out.set(endA + k, endB + k);
  const rows = endA - start;
  const cols = endB - start;
  if (rows && cols && rows * cols <= 4_000_000) {
    const dp: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(cols + 1));
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        dp[i][j] = a[start + i] === b[start + j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < rows && j < cols) {
      if (a[start + i] === b[start + j]) {
        out.set(start + i, start + j);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  return out;
}

export const CONFLICT_NOTE =
  '⚠ This passage was changed on two devices. Your version is above this note; the other device’s version is below it. Keep the one you want and delete the other and this note.';

const note = (): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text: CONFLICT_NOTE, marks: [{ type: 'bold' }] }] });

/** Merges two edited versions of a microchapter. Returns the result and how many passages clashed. */
export function mergeDocs(base: DocNode, local: DocNode, remote: DocNode): { doc: DocNode; conflicts: number } {
  const B = base.content ?? [];
  const L = local.content ?? [];
  const R = remote.content ?? [];
  const key = (n: DocNode) => JSON.stringify(n);
  const kb = B.map(key);
  const kl = L.map(key);
  const kr = R.map(key);
  const ml = matches(kb, kl);
  const mr = matches(kb, kr);

  const out: DocNode[] = [];
  let conflicts = 0;
  let i = 0;
  let l = 0;
  let r = 0;
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, k) => v === y[k]);
  const chunk = (bEnd: number, lEnd: number, rEnd: number) => {
    const b = kb.slice(i, bEnd);
    const lc = kl.slice(l, lEnd);
    const rc = kr.slice(r, rEnd);
    if (same(lc, b)) out.push(...R.slice(r, rEnd));
    else if (same(rc, b) || same(lc, rc)) out.push(...L.slice(l, lEnd));
    else {
      conflicts++;
      out.push(...L.slice(l, lEnd), note(), ...R.slice(r, rEnd));
    }
  };
  for (let k = 0; k < B.length; k++) {
    const lk = ml.get(k);
    const rk = mr.get(k);
    if (lk === undefined || rk === undefined || lk < l || rk < r) continue;
    chunk(k, lk, rk);
    out.push(L[lk]);
    i = k + 1;
    l = lk + 1;
    r = rk + 1;
  }
  chunk(B.length, L.length, R.length);
  return { doc: { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] }, conflicts };
}

// ---------------------------------------------------------------------------
// Binder: node-level merge
// ---------------------------------------------------------------------------

interface Placed {
  node: TreeNode;
  parent: string | null;
  prev: string | null;
}

function flatten(nodes: TreeNode[], parent: string | null = null, out = new Map<string, Placed>()): Map<string, Placed> {
  nodes.forEach((n, i) => {
    out.set(n.id, { node: n, parent, prev: i ? nodes[i - 1].id : null });
    if (n.kind === 'container') flatten(n.children, n.id, out);
  });
  return out;
}

const fields = (n: TreeNode) => {
  const { children: _c, ...rest } = n as ContainerNode;
  return JSON.stringify(rest);
};

/** Takes whichever side changed; if both changed, the local side wins. */
function pick<T>(base: T | undefined, local: T, remote: T): T {
  const eq = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (base !== undefined && eq(local, base)) return remote;
  return local;
}

/**
 * Merges two versions of project.json. Items added on either device are
 * kept, renames and notes are taken from whichever device changed them, and
 * moves too. The trash is combined. If the result would break the book's
 * structure, the local version is kept and `ok` is false.
 */
export function mergeProjects(base: ProjectFile | null, local: ProjectFile, remote: ProjectFile): { project: ProjectFile; ok: boolean } {
  const trashIds = new Set<string>();
  const trash: TreeNode[] = [];
  for (const n of [...local.trash, ...remote.trash]) {
    if (trashIds.has(n.id)) continue;
    trashIds.add(n.id);
    trash.push(n);
  }
  const B = base ? flatten(base.tree) : new Map<string, Placed>();
  const Lm = flatten(local.tree);
  const Rm = flatten(remote.tree);

  type Final = { node: TreeNode; parent: string | null; prev: string | null; fromRemote: boolean };
  const final = new Map<string, Final>();
  const ids = [...new Set([...Lm.keys(), ...Rm.keys()])].filter((id) => !trashIds.has(id));
  for (const id of ids) {
    const b = B.get(id);
    const l = Lm.get(id);
    const r = Rm.get(id);
    if (l && r) {
      const node = JSON.parse(pick(b ? fields(b.node) : undefined, fields(l.node), fields(r.node))) as TreeNode;
      if (node.kind === 'container') node.children = [];
      const moved = b && b.parent === l.parent && b.prev === l.prev && (r.parent !== b.parent || r.prev !== b.prev);
      final.set(id, { node, parent: moved ? r.parent : l.parent, prev: moved ? r.prev : l.prev, fromRemote: !!moved });
    } else {
      const one = (l ?? r)!;
      // Present on one side only: new there (keep), or removed on the other side outside the trash (keep – never lose text).
      const node = JSON.parse(fields(one.node)) as TreeNode;
      if (node.kind === 'container') node.children = [];
      final.set(id, { node, parent: one.parent, prev: one.prev, fromRemote: !l });
    }
  }

  // Rebuild: local order first, then remote-placed items after their remote neighbour.
  const order = new Map<string | null, string[]>();
  const listFor = (p: string | null) => order.get(p) ?? order.set(p, []).get(p)!;
  const walk = (nodes: TreeNode[], remoteSide: boolean) => {
    for (const n of nodes) {
      const f = final.get(n.id);
      if (f && f.fromRemote === remoteSide) {
        const parentKey = f.parent !== null && final.has(f.parent) ? f.parent : null;
        const list = listFor(parentKey);
        if (!list.includes(n.id)) {
          if (!remoteSide) list.push(n.id);
          else {
            const after = f.prev ? list.indexOf(f.prev) : -1;
            list.splice(after + 1, 0, n.id);
          }
        }
      }
      if (n.kind === 'container') walk(n.children, remoteSide);
    }
  };
  walk(local.tree, false);
  walk(remote.tree, true);

  const build = (parent: string | null): TreeNode[] =>
    (order.get(parent) ?? []).map((id) => {
      const n = final.get(id)!.node;
      if (n.kind === 'container') n.children = build(id);
      return n;
    });

  const project: ProjectFile = {
    format: local.format,
    title: pick(base?.title, local.title, remote.title),
    author: pick(base?.author, local.author, remote.author),
    settings: pick(base?.settings, local.settings, remote.settings),
    tree: build(null),
    trash,
  };
  const problems = validateTree({ structure: { levels: project.settings.levels }, children: [...project.tree, ...project.trash] });
  if (problems.length) return { project: local, ok: false };
  return { project, ok: true };
}
