import { App, MarkdownSubView, MarkdownView, TFile } from 'obsidian';
import { FoldRange } from '../core/folds';
import { findMarkdownView } from './file-io';

/** Obsidian's fold state: the ranges plus the line count they were taken at. */
interface FoldInfo {
  folds: FoldRange[];
  lines: number;
}

/**
 * Not public API: `currentMode` carries get/applyFoldInfo, `app.foldManager`
 * stores them per file. Feature-detected, so losing them costs fold sync only.
 */
interface FoldCapableMode extends MarkdownSubView {
  getFoldInfo?: () => FoldInfo | null;
  applyFoldInfo?: (info: FoldInfo) => void;
}

interface FoldStore {
  load?: (file: TFile) => Promise<FoldInfo | null>;
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

/** Folds `file`'s Markdown pane to exactly `folds`. False if it could not. */
export function applyEditorFolds(
  app: App,
  file: TFile,
  folds: FoldRange[],
): boolean {
  const view = findMarkdownView(app, file);
  const mode = foldMode(view);

  if (!view || typeof mode?.applyFoldInfo !== 'function') {
    return false;
  }
  try {
    // applyFoldInfo unfolds and re-folds in two transactions, losing the
    // scroll anchor in between; getScroll is line-based, so it pins it back.
    const scroll = mode.getScroll();

    mode.applyFoldInfo({ folds, lines: view.editor.lineCount() });
    mode.applyScroll(scroll);

    return true;
  } catch (err) {
    console.error('Mindmap: could not apply the editor fold state', err);

    return false;
  }
}

/** Where folds survive a restart. Only for a file with no pane open. */
export async function loadStoredFolds(
  app: App,
  file: TFile,
): Promise<FoldRange[] | null> {
  const store = (app as App & { foldManager?: FoldStore }).foldManager;

  if (typeof store?.load !== 'function') {
    return null;
  }
  try {
    return sanitize(await store.load(file));
  } catch (err) {
    console.error('Mindmap: could not read the stored fold state', err);

    return null;
  }
}
