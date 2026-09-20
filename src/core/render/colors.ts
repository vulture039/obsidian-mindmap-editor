import type { MindNode } from '../parse/parser';

/** Okabe-Ito qualitative hues, ordered to keep adjacent branches distinct. */
export const DEFAULT_PALETTE = [
  'oklch(62% 0.131 244)', // blue #0072b2
  'oklch(64% 0.17 47.5)', // vermillion #d55e00
  'oklch(64% 0.13 165.5)', // bluish green #009e73
  'oklch(67.9% 0.118 346.3)', // reddish purple #cc79a7
  'oklch(78% 0.172 105)', // yellow #f0e442
];

export const BRANCH_FAMILY_COUNT = DEFAULT_PALETTE.length;

/**
 * Last rung the ladder steps down to. Five steps is what the channels hold: the
 * fill runs from a half tint to none, the text size from four points up to one
 * down, and a step below that would have to repeat one of them.
 */
export const DEPTH_CAP = 5;

/**
 * The rung under `rung`. Past the last one the tail alternates between it and
 * one more: the pair is equally quiet and differs in which channel carries the
 * color, so a node is never drawn as its own parent - and none is ever louder.
 */
export function rungBelow(rung: number): number {
  if (rung < DEPTH_CAP) {
    return rung + 1;
  }

  return rung === DEPTH_CAP ? DEPTH_CAP + 1 : DEPTH_CAP;
}

/** Reads one configured branch-family color per non-empty line. */
export function parsePalette(raw: string): string[] {
  const colors = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return colors.length > 0 ? colors : DEFAULT_PALETTE;
}

/**
 * Where a node sits in the color families: which top-level branch it belongs
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

  return branch.parent ? { index: siblingIndex(branch)!, depth } : null;
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

const FAMILY_HUE_OFFSETS = [0, -15, 15, -30, 30, 45];

interface SiblingColor {
  color: string;
  family: string;
  slot: number;
}

// Parsed trees are immutable projections. Weak caches make a wide sibling run
// linear without keeping an old render alive.
const SIBLING_INDEXES = new WeakMap<MindNode, Map<MindNode, number>>();
const SIBLING_COLORS = new WeakMap<MindNode, WeakMap<string[], SiblingColor>>();

function siblingCssColor(family: string, slot: number): string {
  const offset = FAMILY_HUE_OFFSETS[slot]!;

  return offset === 0
    ? family
    : `oklch(from ${family} l c calc(h + ${offset}))`;
}

function siblingIndex(node: MindNode): number | null {
  if (!node.parent) {
    return null;
  }

  let indexes = SIBLING_INDEXES.get(node.parent);

  if (!indexes) {
    indexes = new Map(
      node.parent.children.map((child, index) => [child, index]),
    );
    SIBLING_INDEXES.set(node.parent, indexes);
  }

  return indexes.get(node) ?? null;
}

/**
 * Keeps a top-level branch in one narrow hue family. Children use each slot
 * their parent does not, then repeat without matching adjacent siblings.
 */
function siblingColor(node: MindNode, palette: string[]): SiblingColor | null {
  const cached = SIBLING_COLORS.get(node)?.get(palette);

  if (cached) {
    return cached;
  }
  const index = siblingIndex(node);

  if (index === null) {
    return null;
  }
  if (node.parent?.type === 'root') {
    const family = palette[index % palette.length]!;
    const color = { color: siblingCssColor(family, 0), family, slot: 0 };

    cacheSiblingColor(node, palette, color);

    return color;
  }
  const parent = siblingColor(node.parent!, palette);

  if (!parent) {
    return null;
  }
  const slot =
    (parent.slot + 1 + (index % (FAMILY_HUE_OFFSETS.length - 1))) %
    FAMILY_HUE_OFFSETS.length;

  const color = {
    color: siblingCssColor(parent.family, slot),
    family: parent.family,
    slot,
  };

  cacheSiblingColor(node, palette, color);

  return color;
}

function cacheSiblingColor(
  node: MindNode,
  palette: string[],
  color: SiblingColor,
): void {
  let colors = SIBLING_COLORS.get(node);

  if (!colors) {
    colors = new WeakMap();
    SIBLING_COLORS.set(node, colors);
  }
  colors.set(palette, color);
}

/**
 * Depth counted through headings and list items alike. Counting each kind by
 * its own level was tried and reverted: a list item under an H3 restarted at
 * the first rung, drawing louder than the heading holding it.
 * The root takes no branch color, so there is no level of it to draw.
 */
export function nodeColorFor(
  node: MindNode,
  palette: string[] = DEFAULT_PALETTE,
): NodeColor {
  const pos = branchPosition(node);

  if (!pos) {
    return { color: '', depth: 0 };
  }
  const branchColor = siblingColor(node, palette)!.color;

  return {
    color: branchColor,
    depth:
      pos.depth <= DEPTH_CAP
        ? pos.depth
        : DEPTH_CAP + ((pos.depth - DEPTH_CAP) % 2),
  };
}
