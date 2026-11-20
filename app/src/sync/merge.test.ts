import { describe, expect, it } from 'vitest';
import { newProject } from '../core/projectFile';
import type { ProjectFile } from '../core/projectFile';
import { fictionSettings } from '../core/templates';
import type { DocNode } from '../project/doc';
import { CONFLICT_NOTE, mergeDocs, mergeProjects } from './merge';

const p = (t: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const doc = (...ts: string[]): DocNode => ({ type: 'doc', content: ts.map(p) });
const texts = (d: DocNode) => (d.content ?? []).map((n) => n.content?.[0]?.text ?? '');

describe('merging text edited on two devices', () => {
  it('combines edits to different paragraphs', () => {
    const base = doc('A', 'B', 'C', 'D');
    const { doc: out, conflicts } = mergeDocs(base, doc('A2', 'B', 'C', 'D'), doc('A', 'B', 'C', 'D', 'E'));
    expect(texts(out)).toEqual(['A2', 'B', 'C', 'D', 'E']);
    expect(conflicts).toBe(0);
  });

  it('keeps both versions of a paragraph changed on both devices', () => {
    const { doc: out, conflicts } = mergeDocs(doc('A', 'B', 'C'), doc('A', 'B-laptop', 'C'), doc('A', 'B-desktop', 'C'));
    expect(texts(out)).toEqual(['A', 'B-laptop', CONFLICT_NOTE, 'B-desktop', 'C']);
    expect(conflicts).toBe(1);
  });

  it('treats the same change on both sides as one', () => {
    const { doc: out, conflicts } = mergeDocs(doc('A'), doc('A', 'X'), doc('A', 'X'));
    expect(texts(out)).toEqual(['A', 'X']);
    expect(conflicts).toBe(0);
  });

  it('keeps deletions from one side', () => {
    const { doc: out } = mergeDocs(doc('A', 'B', 'C'), doc('A', 'C'), doc('A', 'B', 'C', 'D'));
    expect(texts(out)).toEqual(['A', 'C', 'D']);
  });
});

describe('merging the binder', () => {
  const base = (): ProjectFile => {
    const pr = newProject('Book', 'Adam', fictionSettings());
    pr.tree = [
      { kind: 'unit', id: 'u1', title: 'One' },
      { kind: 'unit', id: 'u2', title: 'Two' },
    ];
    return pr;
  };
  const clone = (x: ProjectFile) => JSON.parse(JSON.stringify(x)) as ProjectFile;

  it('keeps items added on both devices and renames from either', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    l.tree.push({ kind: 'unit', id: 'u3', title: 'Three (laptop)' });
    r.tree[0].title = 'One renamed';
    r.tree.splice(1, 0, { kind: 'unit', id: 'u9', title: 'Inserted (desktop)' });
    const { project, ok } = mergeProjects(b, l, r);
    expect(ok).toBe(true);
    expect(project.tree.map((n) => n.title)).toEqual(['One renamed', 'Inserted (desktop)', 'Two', 'Three (laptop)']);
  });

  it('takes a move from the device that moved it, and combines the trash', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    r.tree.reverse();
    l.trash.push({ kind: 'unit', id: 'old', title: 'Old' });
    const { project } = mergeProjects(b, l, r);
    expect(project.tree.map((n) => n.id)).toEqual(['u2', 'u1']);
    expect(project.trash.map((n) => n.id)).toEqual(['old']);
  });

  it('never drops an item that one side still has', () => {
    const b = base();
    const l = clone(b);
    const r = clone(b);
    r.tree = r.tree.slice(0, 1);
    const { project } = mergeProjects(b, l, r);
    expect(project.tree.map((n) => n.id)).toEqual(['u1', 'u2']);
  });
});
