import { App, Editor, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';

/** Whether two panes are in the same window - a popout is a window of its own. */
export function sameWindow(a: WorkspaceLeaf, b: WorkspaceLeaf): boolean {
  return a.getContainer() === b.getContainer();
}

/** Whether two panes were split off each other - a pair read side by side. */
export function sameSplit(a: WorkspaceLeaf, b: WorkspaceLeaf): boolean {
  const split = a.parent?.parent;

  return a.parent !== b.parent && !!split && split === b.parent?.parent;
}

/** Itself, its window, or neither: how close a pane is to the one asking. */
export function leafNearness(
  leaf: WorkspaceLeaf,
  near?: WorkspaceLeaf,
): number {
  if (!near) {
    return 0;
  }
  if (leaf === near) {
    return 2;
  }

  return sameWindow(leaf, near) ? 1 : 0;
}

function findView(
  app: App,
  file: TFile,
  sourceOnly: boolean,
  near?: WorkspaceLeaf,
): MarkdownView | null {
  let best: MarkdownView | null = null;
  let closest = -1;

  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;

    if (
      !(view instanceof MarkdownView) ||
      view.file?.path !== file.path ||
      (sourceOnly && view.getMode() !== 'source')
    ) {
      continue;
    }
    const how = leafNearness(leaf, near);

    if (how > closest) {
      best = view;
      closest = how;
    }
  }

  return best;
}

/**
 * The pane showing `file`, nearest `near` first: the same note can be open in
 * two windows, and the map's own is the one it was opened beside.
 */
export function findMarkdownView(
  app: App,
  file: TFile,
  near?: WorkspaceLeaf,
): MarkdownView | null {
  return findView(app, file, false, near);
}

/**
 * Only a pane in source mode. A reading pane keeps an editor too, but it is
 * not the surface the user sees and a write there never reaches the file.
 */
export function findEditingView(
  app: App,
  file: TFile,
  near?: WorkspaceLeaf,
): MarkdownView | null {
  return findView(app, file, true, near);
}

/** Both line endings, since a note can have come from anywhere. */
const LINE = /\r?\n/;

/**
 * Puts lines back together the way `like` had them. A note written on Windows
 * must not turn into a whole-file diff because one line of it was edited.
 */
export function joinLike(lines: string[], like: string): string {
  return lines.join(like.includes('\r\n') ? '\r\n' : '\n');
}

/** A write that went straight to the file, and so has no history behind it. */
export interface WroteToDisk {
  before: string;
  after: string;
}

/**
 * Applies a line-based mutation to the file. When the file is being edited,
 * the change goes through the editor (minimal replaceRange, so undo history is
 * preserved) and there is nothing to hand back; otherwise it is written via
 * vault.process, and both sides of it are returned - nothing else remembers a
 * write like that, so the map has to.
 */
export async function updateFileLines(
  app: App,
  file: TFile,
  mutate: (lines: string[]) => string[],
): Promise<WroteToDisk | null> {
  const mdView = findEditingView(app, file);

  if (mdView) {
    const oldLines = mdView.editor.getValue().split(LINE);
    const newLines = mutate(oldLines.slice());

    applyLineDiff(mdView.editor, oldLines, newLines);

    return null;
  }
  let before = '';
  const after = await app.vault.process(file, (data) => {
    before = data;

    return joinLike(mutate(data.split(LINE)), data);
  });

  return { before, after };
}

function applyLineDiff(
  editor: Editor,
  oldLines: string[],
  newLines: string[],
): void {
  let start = 0;

  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let endOld = oldLines.length - 1;
  let endNew = newLines.length - 1;

  while (
    endOld >= start &&
    endNew >= start &&
    oldLines[endOld] === newLines[endNew]
  ) {
    endOld--;
    endNew--;
  }
  if (endOld < start && endNew < start) {
    return;
  }

  const segment = newLines.slice(start, endNew + 1);
  const lineLen = (i: number): number => (oldLines[i] ?? '').length;

  // Replacement: swap the changed old lines for the new segment.
  if (endOld >= start && segment.length > 0) {
    editor.replaceRange(
      segment.join('\n'),
      { line: start, ch: 0 },
      { line: endOld, ch: lineLen(endOld) },
    );

    return;
  }

  // Pure deletion: remove the lines plus one adjacent newline.
  if (endOld >= start) {
    if (start > 0) {
      editor.replaceRange(
        '',
        { line: start - 1, ch: lineLen(start - 1) },
        { line: endOld, ch: lineLen(endOld) },
      );

      return;
    }
    if (endOld < oldLines.length - 1) {
      editor.replaceRange('', { line: 0, ch: 0 }, { line: endOld + 1, ch: 0 });

      return;
    }
    editor.replaceRange(
      '',
      { line: 0, ch: 0 },
      { line: endOld, ch: lineLen(endOld) },
    );

    return;
  }

  // Pure insertion before line `start`.
  if (start < oldLines.length) {
    editor.replaceRange(segment.map((l) => `${l}\n`).join(''), {
      line: start,
      ch: 0,
    });

    return;
  }

  // Append past the last line.
  editor.replaceRange(`\n${segment.join('\n')}`, {
    line: oldLines.length - 1,
    ch: lineLen(oldLines.length - 1),
  });
}
