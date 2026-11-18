/** The start screen's list of recently opened projects (kept on this computer only). */

export interface RecentProject {
  path: string;
  title: string;
  openedAt: number;
}

const KEY = 'narrivell.recent';
const MAX = 10;

export function readRecent(storage: Pick<Storage, 'getItem'> = localStorage): RecentProject[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(
        (r): r is RecentProject =>
          typeof r === 'object' &&
          r !== null &&
          typeof r.path === 'string' &&
          r.path.length < 1000 &&
          typeof r.title === 'string' &&
          typeof r.openedAt === 'number',
      )
      .map((r) => ({ path: r.path, title: r.title.slice(0, 200), openedAt: r.openedAt }))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberRecent(
  entry: RecentProject,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
): RecentProject[] {
  const list = [entry, ...readRecent(storage).filter((r) => r.path !== entry.path)].slice(0, MAX);
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Not being able to remember a recent project is harmless.
  }
  return list;
}

export function forgetRecent(path: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): RecentProject[] {
  const list = readRecent(storage).filter((r) => r.path !== path);
  try {
    storage.setItem(KEY, JSON.stringify(list));
  } catch {
    // harmless
  }
  return list;
}
