import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, newId, newProject, parseProjectFile, serializeProjectFile } from './projectFile';
import { customSettings, fictionSettings, nonfictionSettings } from './templates';

const sample = () => {
  const project = newProject('The Stillness Index', 'Adam Lenke', fictionSettings('sections-microchapters'));
  project.tree = [
    {
      kind: 'container',
      id: 'seq4',
      levelId: 'section',
      title: 'Sequence IV',
      children: [{ kind: 'unit', id: 'mc1', title: 'The Island' }],
    },
  ];
  return project;
};

describe('project.json round trip', () => {
  it('saves and loads every template unchanged', () => {
    for (const settings of [fictionSettings(), nonfictionSettings(), customSettings()]) {
      const project = newProject('Title', 'Author', settings);
      const result = parseProjectFile(serializeProjectFile(project));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.project).toEqual(project);
    }
  });
  it('keeps the author’s structure and binder', () => {
    const project = sample();
    const result = parseProjectFile(serializeProjectFile(project));
    expect(result.ok && result.project).toEqual(project);
  });
});

describe('untrusted project.json', () => {
  it('rejects broken JSON without throwing', () => {
    expect(parseProjectFile('{ not json').ok).toBe(false);
  });
  it('asks for an update when saved by a newer version', () => {
    const result = parseProjectFile(JSON.stringify({ ...sample(), format: FORMAT_VERSION + 1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('newer version');
  });
  it('rejects unsafe or malformed ids', () => {
    const bad = sample();
    (bad.tree[0] as { id: string }).id = '../../etc/passwd';
    expect(parseProjectFile(JSON.stringify(bad)).ok).toBe(false);
  });
  it('drops unknown fields such as __proto__', () => {
    const json = serializeProjectFile(sample()).replace('"title": "The Stillness Index"', '"title": "The Stillness Index", "__proto__": {"polluted": true}');
    const result = parseProjectFile(json);
    expect(result.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBe(undefined);
    if (result.ok) expect(Object.keys(result.project)).not.toContain('__proto__');
  });
  it('rejects a binder that breaks the structure', () => {
    const bad = sample();
    bad.tree = [{ kind: 'container', id: 'x', levelId: 'microchapter', title: '', children: [] }];
    expect(parseProjectFile(JSON.stringify(bad)).ok).toBe(false);
  });
  it('rejects oversized files', () => {
    expect(parseProjectFile(' '.repeat(5_000_001)).ok).toBe(false);
  });
});

describe('newId', () => {
  it('makes safe, unique ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, newId));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{1,20}$/);
  });
});
