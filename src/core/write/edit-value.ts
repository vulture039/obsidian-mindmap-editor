/** What the text typed into an inline editor becomes before it is written. */

/** A node's label: whatever was pasted in, flattened to a single line. */
export function singleLineValue(raw: string): string {
  return raw.replace(/[\r\n]+/g, ' ').trim();
}
