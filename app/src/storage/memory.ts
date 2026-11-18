import { safeRelativePath } from './paths';
import type { StorageProvider } from './types';

/**
 * Keeps a project in memory. Used by tests, and in the browser (web or
 * development mode) as a try-it-out store saved to localStorage.
 * Not for real manuscripts: browser storage can be cleared.
 */
export class MemoryProvider implements StorageProvider {
  readonly label: string;
  private files = new Map<string, string>();

  constructor(label = 'In memory', private persistKey?: string) {
    this.label = label;
    if (persistKey) {
      try {
        const saved = localStorage.getItem(persistKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
              if (typeof v === 'string') this.files.set(safeRelativePath(k), v);
            }
          }
        }
      } catch {
        // Unreadable saved data: start empty rather than fail.
      }
    }
  }

  async readText(path: string): Promise<string | null> {
    return this.files.get(safeRelativePath(path)) ?? null;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(safeRelativePath(path), text);
    if (this.persistKey) {
      try {
        localStorage.setItem(this.persistKey, JSON.stringify(Object.fromEntries(this.files)));
      } catch {
        throw new Error('Browser storage is full. Use the desktop app for real manuscripts.');
      }
    }
  }

  async makeDir(path: string): Promise<void> {
    safeRelativePath(path);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${safeRelativePath(dir)}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split('/')[0]);
    }
    return [...names].sort();
  }
}
