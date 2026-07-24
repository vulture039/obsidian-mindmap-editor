const LINK_RE =
  /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]|\[([^[\]]+)\]\(([^()\s]+)\)/g;

/** A run of node text: plain text, a [[wikilink]], or a [label](url) link. */
export type NodeSegment =
  | { kind: 'text'; text: string }
  | { kind: 'wikilink'; target: string; label: string }
  | { kind: 'link'; url: string; label: string };

/**
 * Splits node text into ordered segments, recognizing [[wikilinks]] (with an
 * optional alias) and [label](url) links; everything else is plain text.
 * Pure and Obsidian-free — obsidian/node-text.ts renders the segments.
 */
export function parseNodeText(text: string): NodeSegment[] {
  const segments: NodeSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ kind: 'text', text: text.slice(last, index) });
    }
    const wikiTarget = match[1];
    if (wikiTarget !== undefined) {
      const target = wikiTarget.trim();
      const alias = match[2]?.trim();
      segments.push({
        kind: 'wikilink',
        target,
        label: alias?.length ? alias : target,
      });
    } else {
      segments.push({
        kind: 'link',
        url: match[4] ?? '',
        label: match[3] ?? '',
      });
    }
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', text: text.slice(last) });
  }
  return segments;
}
