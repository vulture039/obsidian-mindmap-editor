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
 * A node's own text, trimmed by the line and never as one string: the first
 * line may be indented deeper than the rest, and that indent is exactly what
 * body text keeps to nest a block inside a description.
 */
export function multiLineValue(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');
}
