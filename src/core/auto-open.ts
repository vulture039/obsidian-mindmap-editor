/** Add a note once, without changing the caller's settings array. */
export function rememberAutoOpen(files: string[], path: string): string[] {
  return files.includes(path) ? files : [...files, path];
}

/** Follow a file or an entire folder when Obsidian renames or moves it. */
export function renameAutoOpen(
  files: string[],
  oldPath: string,
  newPath: string,
): string[] {
  const prefix = `${oldPath}/`;

  return [
    ...new Set(
      files.map((path) =>
        path === oldPath || path.startsWith(prefix)
          ? `${newPath}${path.slice(oldPath.length)}`
          : path,
      ),
    ),
  ];
}

/** Forget a deleted file, or every remembered note in a deleted folder. */
export function deleteAutoOpen(files: string[], path: string): string[] {
  const prefix = `${path}/`;

  return files.filter((file) => file !== path && !file.startsWith(prefix));
}

/**
 * Files that currently have a Markdown tab. `open` returns true only for the
 * transition from no tab to a tab; selecting an existing tab is not an open.
 */
export class OpenMarkdownFiles {
  private paths: Set<string>;

  constructor(paths: Iterable<string> = []) {
    this.paths = new Set(paths);
  }

  open(path: string): boolean {
    if (this.paths.has(path)) {
      return false;
    }
    this.paths.add(path);

    return true;
  }

  /** Allow a file to count as newly opened after its last tab has closed. */
  retain(openPaths: Iterable<string>): void {
    const open = new Set(openPaths);

    for (const path of this.paths) {
      if (!open.has(path)) {
        this.paths.delete(path);
      }
    }
  }

  rename(oldPath: string, newPath: string): void {
    this.paths = new Set(renameAutoOpen([...this.paths], oldPath, newPath));
  }
}
