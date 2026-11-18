/**
 * Where a project's files live. Paths are always relative to the project
 * folder and use "/" separators; providers refuse anything that could
 * escape the project folder.
 *
 * There is deliberately no delete operation: nothing in Narrivell can
 * remove a file from disk in this version.
 */
export interface StorageProvider {
  /** Shown to the author, e.g. the folder path. */
  readonly label: string;
  /** Returns null when the file doesn't exist. */
  readText(path: string): Promise<string | null>;
  /** Writes safely: never leaves a half-written file in place of a good one. */
  writeText(path: string, text: string): Promise<void>;
  makeDir(path: string): Promise<void>;
  /** Names directly inside a folder (empty when it doesn't exist). */
  list(dir: string): Promise<string[]>;
}
