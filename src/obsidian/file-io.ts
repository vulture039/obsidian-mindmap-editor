import { App, Editor, MarkdownView, TFile } from 'obsidian';

export function findMarkdownView(app: App, file: TFile): MarkdownView | null {
  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const view = leaf.view;

    if (view instanceof MarkdownView && view.file?.path === file.path) {
      return view;
    }
  }

  return null;
}

/**
 * Applies a line-based mutation to the file. When the file is open in an
 * editor, the change goes through the editor (minimal replaceRange, so undo
 * history is preserved); otherwise it is written via vault.process.
 */
export async function updateFileLines(
  app: App,
  file: TFile,
  mutate: (lines: string[]) => string[],
): Promise<void> {
  const mdView = findMarkdownView(app, file);

  if (mdView) {
    const oldLines = mdView.editor.getValue().split('\n');
    const newLines = mutate(oldLines.slice());

    applyLineDiff(mdView.editor, oldLines, newLines);
  } else {
    await app.vault.process(file, (data) =>
      mutate(data.split('\n')).join('\n'),
    );
  }
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
