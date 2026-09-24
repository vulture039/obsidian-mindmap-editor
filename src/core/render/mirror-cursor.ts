export interface MirroredLine {
  before: string;
  after: string;
}

/**
 * Places an editor cursor in the body text the map draws. The rendered copy
 * tells us only how much structural indent the parser removed; the current
 * text and cursor always come straight from Obsidian's editor.
 */
export function mirrorCursorInBody(
  current: string,
  cursor: number,
  renderedSource: string,
  renderedBody: string,
  displayIndent = /^\s*/.exec(renderedBody)?.[0] ?? '',
): MirroredLine {
  const sourceIndent = /^\s*/.exec(renderedSource)?.[0] ?? '';
  const bodyIndent = /^\s*/.exec(renderedBody)?.[0] ?? '';
  const removed = sourceIndent.slice(
    0,
    Math.max(0, sourceIndent.length - bodyIndent.length),
  );
  const text = current.startsWith(removed)
    ? current.slice(removed.length)
    : current;
  const bodyIndentLength = bodyIndent.length;
  const content = bodyIndent ? text.slice(bodyIndentLength) : text;
  const displayed = `${displayIndent}${content}`;
  const at = Math.min(
    displayed.length,
    displayIndent.length +
      Math.max(
        0,
        cursor -
          (current.startsWith(removed) ? removed.length : 0) -
          bodyIndentLength,
      ),
  );

  return { before: displayed.slice(0, at), after: displayed.slice(at) };
}
