/**
 * What the text typed into an inline editor becomes before it is written back.
 * A label is one line by definition; body text keeps the shape it was given,
 * because that shape is what ends up in the file.
 */

/** A node's label: whatever was pasted in, flattened to a single line. */
export function singleLineValue(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * A node's own text. Trimmed at the end only: the first line may be indented
 * deeper than the rest, and a blank line at the top is a line the user can
 * see - dropping it would take a line nobody asked to remove.
 */
export function multiLineValue(raw: string): string {
  return raw.replace(/\r/g, '').replace(/\s+$/, '');
}
