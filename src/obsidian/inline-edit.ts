import { setIcon } from 'obsidian';
import { multiLineValue, singleLineValue } from '../core/edit-value';
import { BodyLine } from '../core/parser';

/** Caret position meaning "past the last character". */
export const CARET_AT_END = -1;

/** How long focus is given to arrive before the edit is retried, then given up. */
const FOCUS_RETRY_DELAY = 50;

/** What an inline edit needs from the view it runs in. */
export interface EditSession {
  /** The contenteditable to run in; already in place, already styled. */
  input: HTMLElement;
  /** Enter breaks the line instead of saving, and buttons appear. */
  multiline: boolean;
  placeCaret: () => void;
  /** Puts back what the editor replaced, when nothing was written. */
  restore: () => void;
  /** Saves; true when it started a write, which redraws on its own. */
  commit: (value: string) => boolean;
  setEditing: (editing: boolean) => void;
  /** Re-lays out the map around the growing text. */
  reflow: () => void;
  /** Runs a render the edit held off; true when it did. */
  settle: () => boolean;
}

/**
 * Runs an inline edit: the busy flag, the commit/cancel keys, and the focus
 * net that aborts rather than leaving the map frozen with no blur to come.
 */
export function runEditor(session: EditSession): void {
  const { input, multiline, placeCaret, restore, commit } = session;

  session.setEditing(true);
  input.contentEditable = 'plaintext-only';
  // Multi-line text has no Enter to leave by, so it gets buttons - a
  // double-click would have to take word selection away to serve as one.
  const controls = multiline ? addControls(input, session.reflow) : null;
  const read = multiline ? multiLineValue : singleLineValue;
  let done = false;
  const finish = (save: boolean): void => {
    if (done) {
      return;
    }
    done = true;
    session.setEditing(false);
    controls?.el.remove();

    if (save && commit(read(input.textContent ?? ''))) {
      return;
    }
    if (session.settle()) {
      return;
    }
    restore();
  };

  // Clicks inside the editor must not reach the node handlers, which would
  // move focus to the map and close the edit via blur.
  for (const type of ['pointerdown', 'click', 'dblclick'] as const) {
    input.addEventListener(type, (ev) => ev.stopPropagation());
  }
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    // IME candidate confirmation also fires a "real" Enter keydown with
    // isComposing still true — that must only close the IME composition,
    // not the inline edit itself.
    if (ev.isComposing) {
      return;
    }
    // Multi-line text needs Enter for what Enter is for, so saving moves to
    // Mod+Enter there.
    if (ev.key === 'Enter' && (!multiline || ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  // Growing text pushes the node's neighbours around, and renders are held
  // off while editing - so lay the map out again as it is typed.
  input.addEventListener('input', () => session.reflow());
  controls?.bind(finish);
  input.focus();
  placeCaret();
  // A closing menu or leaf activation can keep focus away right as the edit
  // opens. Without focus the blur handler can never fire, so retry once, then
  // abort the edit instead of leaving it stuck.
  input.win.setTimeout(() => {
    if (done || input.doc.activeElement === input) {
      return;
    }
    input.focus();
    placeCaret();
    input.win.setTimeout(() => {
      if (!done && input.doc.activeElement !== input) {
        finish(false);
      }
    }, FOCUS_RETRY_DELAY);
  }, 0);
}

/**
 * Save and discard buttons under an editor. Their pointerdown is swallowed so
 * the press cannot blur the editor out from under the click about to use it.
 */
function addControls(
  input: HTMLElement,
  reflow: () => void,
): { el: HTMLElement; bind: (finish: (save: boolean) => void) => void } {
  const el = createDiv({ cls: 'mindmap-edit-controls' });
  const buttons: [icon: string, label: string, save: boolean][] = [
    ['check', 'Save (Ctrl/Cmd + Enter)', true],
    ['x', 'Discard (Esc)', false],
  ];
  const made = buttons.map(([icon, label, save]) => {
    const button = el.createDiv({
      cls: 'mindmap-edit-button',
      attr: { 'aria-label': label },
    });

    setIcon(button, icon);

    return { button, save };
  });

  input.after(el);
  reflow();

  return {
    el,
    bind: (finish) => {
      for (const { button, save } of made) {
        for (const type of ['pointerdown', 'dblclick'] as const) {
          button.addEventListener(type, (e) => {
            e.preventDefault();
            e.stopPropagation();
          });
        }
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          finish(save);
        });
      }
    },
  };
}

/** Caret at `offset` into the editor's text, or at its end for CARET_AT_END. */
export function putCaret(input: HTMLElement, offset: number): void {
  const textNode = input.firstChild;
  const range = input.doc.createRange();

  range.selectNodeContents(input);
  if (textNode && offset >= 0) {
    range.setStart(
      textNode,
      Math.min(offset, (textNode.textContent ?? '').length),
    );
  }
  // Never a selection: the next keystroke would wipe the text it holds.
  // Collapsing forward for a set offset, to the very end without one.
  range.collapse(offset >= 0);
  const sel = input.win.getSelection();

  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Ends the caret on the body line the double-click landed on - where the
 * editor's own cursor lands when the map sends it to a line.
 */
export function caretAtBodyLine(
  input: HTMLElement,
  run: BodyLine[],
  line: number,
): void {
  const index = run.findIndex((b) => b.line === line);
  const upto = index < 0 ? run.length : index + 1;
  const offset =
    run.slice(0, upto).reduce((n, b) => n + b.text.length + 1, 0) - 1;

  putCaret(input, offset);
}
