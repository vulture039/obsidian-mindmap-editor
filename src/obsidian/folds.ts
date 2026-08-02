import { App, MarkdownSubView, MarkdownView, TFile } from 'obsidian';
import { FoldRange } from '../core/folds';
import { findEditingView, findMarkdownView } from './file-io';

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

/**
 * Keeps every fold that names a line. Reading view puts a count where the
 * editor puts an end line, and dropping those lost the fold altogether.
 */
function sanitize(info: unknown): FoldRange[] | null {
  const folds = (info as FoldInfo | null)?.folds;

  if (!Array.isArray(folds)) {
    return null;
  }

  return folds
    .filter((f) => typeof f?.from === 'number' && f.from >= 0)
    .map((f) => ({
      from: f.from,
      to: typeof f.to === 'number' && f.to > f.from ? f.to : f.from,
    }));
}

function foldMode(view: MarkdownView | null): FoldCapableMode | undefined {
  return view?.currentMode;
}

/**
 * The folds `file`'s pane holds; null (no pane, no API) is not "none". The
 * editing pane wins: its ranges are real, and only it can be written to.
 */
export function readEditorFolds(app: App, file: TFile): FoldRange[] | null {
  const view = findEditingView(app, file) ?? findMarkdownView(app, file);
  const mode = foldMode(view);

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

/** How a write went. Only `Failed` means the API itself let us down. */
export enum FoldWrite {
  Applied = 'applied',
  Unsupported = 'unsupported',
  Failed = 'failed',
}

/** Folds `file`'s editing pane to exactly `folds`. */
export function applyEditorFolds(
  app: App,
  file: TFile,
  folds: FoldRange[],
): FoldWrite {
  const view = findEditingView(app, file);
  const mode = foldMode(view);

  if (!view || typeof mode?.applyFoldInfo !== 'function') {
    return FoldWrite.Unsupported;
  }
  try {
    // applyFoldInfo unfolds and re-folds in two transactions, losing the
    // scroll anchor in between; getScroll is line-based, so it pins it back.
    const scroll = mode.getScroll();

    mode.applyFoldInfo({ folds, lines: view.editor.lineCount() });
    mode.applyScroll(scroll);

    return FoldWrite.Applied;
  } catch (err) {
    console.error('Mindmap: could not apply the editor fold state', err);

    return FoldWrite.Failed;
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
