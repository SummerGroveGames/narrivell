import { exists, mkdir, readDir, readTextFile, rename, writeTextFile } from '@tauri-apps/plugin-fs';
import { safeRelativePath } from './paths';
import type { StorageProvider } from './types';

/**
 * A project folder on the author's disk (Windows/Linux app).
 * Access is limited by Tauri to folders the author picked in the system
 * folder dialog (see pick_folder in src-tauri/src/lib.rs).
 */
export class TauriFolderProvider implements StorageProvider {
  readonly label: string;

  constructor(readonly root: string) {
    this.label = root;
  }

  /** Joins with the separator the root already uses (\\ on Windows), so Tauri's folder permissions match. */
  private abs(path: string): string {
    const sep = this.root.includes('\\') ? '\\' : '/';
    return `${this.root.replace(/[\\/]+$/, '')}${sep}${safeRelativePath(path).split('/').join(sep)}`;
  }

  async readText(path: string): Promise<string | null> {
    const full = this.abs(path);
    if (!(await exists(full))) return null;
    return readTextFile(full);
  }

  /** Write to a temporary file first, then swap it in, so a crash or power cut never leaves a half-written file. */
  async writeText(path: string, text: string): Promise<void> {
    const full = this.abs(path);
    const temp = `${full}.saving`;
    await writeTextFile(temp, text);
    await rename(temp, full);
  }

  async makeDir(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true });
  }

  async list(dir: string): Promise<string[]> {
    const full = this.abs(dir);
    if (!(await exists(full))) return [];
    return (await readDir(full)).map((e) => e.name).sort();
  }
}
