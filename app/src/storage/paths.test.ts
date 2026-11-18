import { describe, expect, it } from 'vitest';
import { projectFolderName, safeRelativePath, stamp } from './paths';
import { readRecent, rememberRecent } from '../project/recent';

describe('safeRelativePath', () => {
  it('accepts normal project paths, including dot folders', () => {
    expect(safeRelativePath('manuscript/abc.json')).toBe('manuscript/abc.json');
    expect(safeRelativePath('.history/abc/2026-11-18T17-00-00-000Z.json')).toContain('.history');
  });

  it('refuses anything that could leave the project folder', () => {
    for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', 'C:/Windows', 'a\\b', 'a//b', './x', 'a/b.', 'x\u0000y']) {
      expect(() => safeRelativePath(bad)).toThrow();
    }
  });
});

describe('projectFolderName', () => {
  it('makes safe folder names', () => {
    expect(projectFolderName('The Stillness Index: Book 1')).toBe('The Stillness Index Book 1.narrivell');
    expect(projectFolderName('***')).toBe('Untitled.narrivell');
    expect(projectFolderName('CON')).toBe('Book CON.narrivell');
  });

  it('makes Windows-safe timestamps', () => {
    expect(stamp(new Date(Date.UTC(2026, 10, 18, 17, 41, 5, 123)))).toBe('2026-11-18T17-41-05-123Z');
  });
});

describe('recent projects', () => {
  const fake = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it('keeps the newest first without duplicates', () => {
    const s = fake();
    rememberRecent({ path: 'A', title: 'A', openedAt: 1 }, s);
    rememberRecent({ path: 'B', title: 'B', openedAt: 2 }, s);
    rememberRecent({ path: 'A', title: 'A', openedAt: 3 }, s);
    expect(readRecent(s).map((r) => r.path)).toEqual(['A', 'B']);
  });

  it('ignores damaged data', () => {
    const s = fake();
    s.setItem('narrivell.recent', '{"not":"a list"}');
    expect(readRecent(s)).toEqual([]);
  });
});
