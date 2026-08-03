import { MarkdownView } from 'obsidian';
import { MindNode } from '../../core/parse/parser';

/** What a reading pane renders as one block: where it starts, and how long. */
export interface PreviewBlock {
  first: number;
  lines: number;
}

/** The registered highlight, and the class that quiets the block flash. */
const HIGHLIGHT = 'mindmap-line';
const QUIET = 'mindmap-quiet-flash';
/** Long enough to outlast the flash, for when its element is never seen off. */
const FLASH_MS = 5000;

let fade: number | null = null;
let watch: MutationObserver | null = null;

/**
 * The block a line is rendered in: the lines around it that are consecutive
 * and not blank, since a blank line starts a paragraph of its own. A list
 * item's text is rendered with its label, so that block reaches back to the
 * node; a heading's does not - it is a block of its own.
 */
export function blockOf(node: MindNode, line: number): PreviewBlock {
  if (line === node.line && node.type !== 'list') {
    return { first: line, lines: 1 };
  }
  const bodyLine = (at: number): string | undefined =>
    node.body.find((b) => b.line === at)?.text;
  let first = line;
  let last = line;

  while (bodyLine(first - 1)?.trim()) {
    first--;
  }
  while (bodyLine(last + 1)?.trim()) {
    last++;
  }
  if (node.type === 'list' && first === node.line + 1) {
    first = node.line;
  }

  return { first, lines: last - first + 1 };
}

/**
 * Narrows a reading pane's mark to one line. Obsidian points at a rendered
 * block, which for a list item is the item and everything under it, so picking
 * a line lights up its neighbours. Reading view puts one `<br>`-separated run
 * per source line, so the run for the line can be marked instead.
 *
 * False unless the rendering lines up run for line with `block`, which a code
 * block or a table does not: the flash is then what the pane is left with, and
 * a mark that could land on a line nobody picked is never put up.
 */
export function markPreviewLine(
  view: MarkdownView,
  line: number,
  block: PreviewBlock,
): boolean {
  const flashed = flashedBlock(view);

  if (!flashed) {
    return false;
  }
  const { runs, whole } = ownRuns(flashed);
  const range = runs[line - block.first];

  // A run per line, or the two are not the same block. One run covering all of
  // it and nothing else: the flash already means that one line.
  if (!range || runs.length !== block.lines || (whole && runs.length < 2)) {
    return false;
  }
  clearPreviewLine();
  CSS.highlights.set(HIGHLIGHT, new Highlight(range));
  view.containerEl.addClass(QUIET);
  // Both marks go out together: the class is all that quiets the block, and
  // Obsidian keeps its flash on for a good second longer than one expects.
  watch = new MutationObserver(() => {
    if (!flashed.hasClass('is-flashing')) {
      clearPreviewLine();
    }
  });
  watch.observe(flashed, { attributeFilter: ['class'] });
  fade = view.containerEl.win.setTimeout(clearPreviewLine, FLASH_MS);

  return true;
}

/**
 * Takes the reading pane's scroll, to settle once it has been pointed at a
 * line. Obsidian scrolls its target under the top edge of the pane whether or
 * not the reader was already looking at it, so: put the page back where it was
 * if the block was on screen, and otherwise show the block in the middle.
 */
export function keepPreviewScroll(view: MarkdownView): () => void {
  const pane = view.containerEl.querySelector('.markdown-preview-view');
  const was = pane?.scrollTop ?? 0;

  return () => {
    const block = flashedBlock(view);

    if (!pane || !block) {
      return;
    }
    const box = block.getBoundingClientRect();
    const port = pane.getBoundingClientRect();
    // The pane has moved by now, so take the block back through that to where
    // it was when the user clicked.
    const shift = pane.scrollTop - was;

    if (box.top + shift >= port.top && box.bottom + shift <= port.bottom) {
      pane.scrollTop = was;
    } else if (box.top < port.top || box.bottom > port.bottom) {
      block.scrollIntoView({ block: 'center' });
    }
  };
}

/**
 * Only the rendered pane's flash, never the editor's: a pane in reading view
 * keeps its source view around, flash and all, and that one is not on screen.
 */

function flashedBlock(view: MarkdownView): Element | null {
  return view.containerEl.querySelector('.markdown-preview-view .is-flashing');
}

/** Takes the mark off, wherever it was left. */
export function clearPreviewLine(): void {
  CSS.highlights.delete(HIGHLIGHT);
  document.querySelectorAll(`.${QUIET}`).forEach((el) => el.removeClass(QUIET));
  watch?.disconnect();
  watch = null;
  if (fade !== null) {
    window.clearTimeout(fade);
    fade = null;
  }
}

/**
 * The block's own text, a range per rendered line, and whether that is all the
 * block holds - a list item also holds the list nested under it, which belongs
 * to the nodes below rather than to this line.
 */
function ownRuns(block: Element): { runs: Range[]; whole: boolean } {
  // Several lines are wrapped in a paragraph of their own; a single one is not.
  const text = block.querySelector(':scope > p') ?? block;
  const runs: Range[] = [];
  let run: Range | null = null;
  let whole = true;

  for (const node of Array.from(text.childNodes)) {
    if (node.nodeName === 'UL' || node.nodeName === 'OL') {
      whole = false;

      break;
    }
    if (node.nodeName === 'BR') {
      run = null;

      continue;
    }
    // The bullet is drawn in a span of its own, and the newlines between the
    // rendered tags are nothing on screen: neither is part of a line.
    if (
      (node.instanceOf(Element) && node.hasClass('list-bullet')) ||
      !(node.textContent ?? '').trim()
    ) {
      continue;
    }
    if (!run) {
      run = block.doc.createRange();
      if (node.nodeType === Node.TEXT_NODE) {
        run.setStart(node, leadingSpace(node));
      } else {
        run.setStartBefore(node);
      }
      runs.push(run);
    }
    // Stop at the text, not after it: the source newline before the next tag
    // is in the same text node, and a mark over it would trail off the line.
    if (node.nodeType === Node.TEXT_NODE) {
      run.setEnd(node, (node.textContent ?? '').trimEnd().length);
    } else {
      run.setEndAfter(node);
    }
  }

  return { runs, whole };
}

/**
 * Where the run's text really starts. The newline that followed the `<br>` in
 * the source is still in the text node, collapsed to nothing on screen; a mark
 * that took it in would start with a blank.
 */
function leadingSpace(node: Node): number {
  const text = node.textContent ?? '';

  return text.length - text.trimStart().length;
}
