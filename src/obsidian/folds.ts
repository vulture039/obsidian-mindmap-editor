import { App, MarkdownSubView, MarkdownView, TFile } from 'obsidian';
import { FoldRange } from '../core/folds';
import { findMarkdownView } from './file-io';

/** Obsidian's fold state: the ranges plus the line count they were taken at. */
interface FoldInfo {
  folds: FoldRange[];
  lines: number;
}

/**
 * Not public API: `currentMode` carries getFoldInfo. Feature-detected, so
 * losing it costs fold sync only.
 */
interface FoldCapableMode extends MarkdownSubView {
  getFoldInfo?: () => FoldInfo | null;
}

/** Keeps only well-formed ranges, whatever the untyped call returned. */
function sanitize(info: unknown): FoldRange[] | null {
  const folds = (info as FoldInfo | null)?.folds;

  if (!Array.isArray(folds)) {
    return null;
  }

  return folds.filter(
    (f) =>
      typeof f?.from === 'number' &&
      typeof f?.to === 'number' &&
      f.from >= 0 &&
      f.to >= f.from,
  );
}

function foldMode(view: MarkdownView | null): FoldCapableMode | undefined {
  return view?.currentMode;
}

/** The folds `file`'s pane shows; null (no pane, no API) is not "none". */
export function readEditorFolds(app: App, file: TFile): FoldRange[] | null {
  const mode = foldMode(findMarkdownView(app, file));

  if (typeof mode?.getFoldInfo !== 'function') {
    return null;
  }
  try {
    return sanitize(mode.getFoldInfo()) ?? [];
  } catch (err) {
    console.error('Mindmap: could not read the editor fold state', err);

    return null;
  }
}
