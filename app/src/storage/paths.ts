/** Path safety for everything Narrivell reads or writes inside a project. */

const SEGMENT = /^[A-Za-z0-9._-][A-Za-z0-9._ -]{0,119}$/;

/**
 * Validates a path relative to the project folder and returns it normalised.
 * Rejects absolute paths, drive letters, backslashes, "." and "..", and any
 * unusual characters, so nothing can ever escape the project folder.
 */
export function safeRelativePath(path: string): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 400) {
    throw new Error('Invalid path.');
  }
  const segments = path.split('/');
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..' || s.endsWith(' ') || s.endsWith('.')) {
      throw new Error(`Invalid path: ${path}`);
    }
  }
  return segments.join('/');
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** A safe folder name for a new project, e.g. "The Stillness Index.narrivell". */
export function projectFolderName(title: string): string {
  let base = title
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  if (!base) base = 'Untitled';
  if (WINDOWS_RESERVED.test(base)) base = `Book ${base}`;
  return `${base}.narrivell`;
}

/** File-system-safe timestamp, e.g. 2026-11-18T17-41-05-123Z. */
export function stamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
