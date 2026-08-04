import type { MindNode } from '../parse/parser';

export const DEFAULT_PALETTE = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#6366f1',
  '#14b8a6',
  '#eab308',
];

/**
 * Last rung of the level ladder: three steps are as many as anyone reads at a
 * glance, and a fourth only makes the third harder to see.
 */
export const DEPTH_CAP = 3;

/**
 * Parses one color per line from the settings textarea. Falls back to
 * the default palette if the result would otherwise be empty.
 */
export function parsePalette(raw: string): string[] {
  const colors = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return colors.length > 0 ? colors : DEFAULT_PALETTE;
}

export function branchColorFor(index: number, palette: string[]): string {
  // palette is always non-empty: parsePalette guarantees it.
  return palette[index % palette.length]!;
}

/**
 * Where a node sits in the palette's terms: which top-level branch it belongs
 * to, and how many levels below that branch it is. Null for the root, which
 * carries no branch color.
 */
export function branchPosition(
  node: MindNode,
): { index: number; depth: number } | null {
  let depth = 0;
  let branch = node;

  while (branch.parent && branch.parent.type !== 'root') {
    branch = branch.parent;
    depth++;
  }

  return branch.parent
    ? { index: branch.parent.children.indexOf(branch), depth }
    : null;
}

/**
 * What a node draws itself in: which branch's color, and which rung of the
 * level ladder. A number rather than a finished color, because the rung is
 * what the stylesheet steps the fill, the outline and the text size with.
 */
export interface NodeColor {
  color: string;
  depth: number;
}

/**
 * Depth counted through headings and list items alike. Counting each kind by
 * its own level was tried and reverted: a list item under an H3 restarted at
 * the first rung, drawing louder than the heading holding it.
 * The root takes no branch color, so there is no level of it to draw.
 */
export function nodeColorFor(node: MindNode, palette: string[]): NodeColor {
  const pos = branchPosition(node);

  return pos
    ? {
        color: branchColorFor(pos.index, palette),
        depth: Math.min(pos.depth, DEPTH_CAP),
      }
    : { color: '', depth: 0 };
}
