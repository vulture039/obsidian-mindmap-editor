import { App, MarkdownSubView, MarkdownView, TFile } from 'obsidian';
import { FoldRange } from '../../core/folds';
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

/** A rendered block, as the reading pane keeps them: level 7 is not a heading. */
interface PreviewSection {
  start?: { line: number };
  el?: HTMLElement;
}

interface PreviewMode extends MarkdownSubView {
  renderer?: { sections?: PreviewSection[] };
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

/**
 * Folds a reading pane's headings to match the map. It will not take a fold
 * state - applyFoldInfo does nothing there - but each heading carries a handle
 * of its own, and clicking it folds that section. Its lists have handles too,
 * with nothing tying them back to a line, so those stay the reader's own.
 */
export async function foldPreviewHeadings(
  app: App,
  file: TFile,
  folded: Set<number>,
): Promise<void> {
  // A heading that is folded away has not been rendered, so its own handle is
  // not there to click yet - and a pane draws more of itself as it scrolls.
  // Each pass reaches what the last one brought back, and a pass that clicks
  // nothing is the end of it.
  for (let pass = 0; pass < PASSES; pass++) {
    if (!foldPass(app, file, folded)) {
      return;
    }
    await sleep(RENDER_DELAY);
  }
}

/** One pass over the rendered headings; true when it changed any of them. */
function foldPass(app: App, file: TFile, folded: Set<number>): boolean {
  let clicked = false;

  for (const leaf of app.workspace.getLeavesOfType('markdown')) {
    const md = leaf.view;

    if (
      !(md instanceof MarkdownView) ||
      md.file?.path !== file.path ||
      md.getMode() === 'source'
    ) {
      continue;
    }
    const sections = (md.currentMode as PreviewMode).renderer?.sections ?? [];

    for (const section of sections) {
      const at = section.start?.line;
      const handle = section.el?.querySelector<HTMLElement>(
        '.heading-collapse-indicator',
      );

      // What the handle shows, not what the section says: the two disagree,
      // and the handle is what the reader is looking at.
      if (
        handle &&
        at !== undefined &&
        folded.has(at) !== handle.hasClass('is-collapsed')
      ) {
        handle.click();
        clicked = true;
      }
    }
  }

  return clicked;
}

/** Long enough for the pane to draw what a fold just brought back. */
const RENDER_DELAY = 80;
/** Deeper than any note nests, with room for what scrolling brings in. */
const PASSES = 8;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

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
