import { BodyLine } from '../../core/parse/parser';

/** How long focus is given to arrive before the edit is retried, then given up. */
const FOCUS_RETRY_DELAY = 50;

/**
 * How long typing must pause before what was typed goes to the file. Short
 * enough that both sides are the same thing, long enough that a word is one
 * write rather than five.
 */
const SETTLE_DELAY = 300;

/** What an inline edit needs from the view it runs in. */
export interface EditSession {
  /** The element to run in; already in place, already styled. */
  input: HTMLElement;
  /** Enter breaks the line here, rather than ending the edit. */
  multiline: boolean;
  /** What the editor is holding, as it would go into the file. */
  value: () => string;
  placeCaret: () => void;
  /** The editor is over: puts the drawn text back, and whatever else ends. */
  restore: () => void;
  /** Writes what is in the editor; called as it is typed, and once at the end. */
  write: (value: string) => void;
  setEditing: (editing: boolean) => void;
  /** Sizes the editor to what it holds, for one that does not grow by itself. */
  fit?: () => void;
  /** Re-lays out the map around the growing text. */
  reflow: () => void;
  /** Runs a render the edit held off; true when it did. */
  settle: () => boolean;
}

/**
 * Runs an inline edit. What is typed goes to the file as it is typed, a moment
 * behind the keys - the map is one side of a note, not a form to submit - so
 * there is nothing here to confirm and nothing to lose by leaving. Undo is the
 * editor's, as it is for every other way this plugin writes.
 */
export function runEditor(session: EditSession): () => void {
  const { input, multiline, placeCaret, restore, write, value } = session;

  session.setEditing(true);
  // A label is edited in place, in the span that draws it; a node's own text
  // has a textarea of its own, which is editable by being one.
  if (!input.instanceOf(HTMLTextAreaElement)) {
    input.contentEditable = 'plaintext-only';
  }
  let done = false;
  let composing = false;
  let pending: number | null = null;
  const put = (): void => {
    // A render can take the editor's element with it while a write is still
    // pending: what it holds is then older than the file it would go into.
    if (done || !input.isConnected) {
      return;
    }
    if (pending !== null) {
      input.win.clearTimeout(pending);
      pending = null;
    }
    // Mid-composition an IME's own working text is in the element: a CJK
    // reading would land in the file, to be replaced when it is confirmed.
    if (!composing) {
      write(value());
    }
  };
  const soon = (): void => {
    if (done) {
      return;
    }
    if (pending !== null) {
      input.win.clearTimeout(pending);
    }
    pending = input.win.setTimeout(put, SETTLE_DELAY);
  };
  const finish = (): void => {
    if (done) {
      return;
    }
    session.setEditing(false);
    input.doc.removeEventListener('keydown', onKey, true);
    // The last of what was typed goes before the flag does; nothing typed
    // after this can reach the file.
    put();
    done = true;
    // Always, and before the render: restore is the end of the edit, not only
    // how the drawn text comes back - the note's rename hangs off it. A queued
    // render then redraws over whatever it put back.
    restore();
    session.settle();
  };

  // Clicks inside the editor must not reach the node handlers, which would
  // move focus to the map and close the edit.
  for (const type of ['pointerdown', 'click', 'dblclick'] as const) {
    input.addEventListener(type, (ev) => ev.stopPropagation());
  }

  // On the document, in the capture phase: a key this deep in the app can
  // otherwise be taken before the element ever sees it. Keys are only acted on
  // while the edit owns the focus.
  const onKey = (ev: KeyboardEvent): void => {
    if (done || input.doc.activeElement !== input) {
      return;
    }
    ev.stopPropagation();
    // An IME's confirming Enter is a real keydown with isComposing still set:
    // it belongs to the composition, not to this editor.
    if (ev.isComposing) {
      return;
    }
    if (ev.key === 'Escape' || (ev.key === 'Enter' && !multiline)) {
      ev.preventDefault();
      finish();
    } else if (ev.key === 'Tab') {
      // Focus is what ends an edit, and Tab moves it: the edit would close on
      // a keystroke nobody means as "done". It does nothing here instead.
      ev.preventDefault();
    }
  };

  input.doc.addEventListener('keydown', onKey, true);
  // Focus leaving for the Markdown pane, another window, anywhere outside the
  // map: the edit stays where it is, so coming back carries on where it left
  // off. What is typed is already in the file, so there is nothing to lose by
  // waiting - only the map's renders, which stand down while an edit is on.
  input.addEventListener('blur', (ev) => {
    const to = ev.relatedTarget;

    put();
    if (to instanceof Node && input.closest('.mindmap-canvas')?.contains(to)) {
      finish();

      return;
    }
    session.setEditing(false);
  });
  input.addEventListener('focus', () => {
    if (!done) {
      session.setEditing(true);
    }
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    soon();
  });
  // Growing text pushes the node's neighbours around, and renders are held off
  // while editing - so lay the map out again as it is typed, and put what was
  // typed in the file a moment later.
  input.addEventListener('input', () => {
    session.fit?.();
    session.reflow();
    soon();
  });
  session.fit?.();
  input.focus();
  placeCaret();
  // A closing menu or leaf activation can keep focus away right as the edit
  // opens. Without focus the blur handler can never fire, so retry once, then
  // give up on the edit instead of leaving the map frozen.
  input.win.setTimeout(() => {
    if (done || input.doc.activeElement === input) {
      return;
    }
    input.focus();
    placeCaret();
    input.win.setTimeout(() => {
      if (!done && input.doc.activeElement !== input) {
        finish();
      }
    }, FOCUS_RETRY_DELAY);
  }, 0);

  return finish;
}

/** Caret past the last character of a label, which is where a rename starts. */
export function caretAtEnd(input: HTMLElement): void {
  const range = input.doc.createRange();

  range.selectNodeContents(input);
  // Never a selection: the next keystroke would wipe the text it holds.
  range.collapse(false);
  const sel = input.win.getSelection();

  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * The end of the body line the double-click landed on - where the editor's own
 * cursor lands when the map sends it to a line.
 */
export function offsetOfBodyLine(run: BodyLine[], line: number): number {
  const index = run.findIndex((b) => b.line === line);
  const upto = index < 0 ? run.length : index + 1;

  return run.slice(0, upto).reduce((n, b) => n + b.text.length + 1, 0) - 1;
}
