import { MindNode } from '../parse/parser';

export interface LaidNode {
  node: MindNode;
  el: HTMLElement;
  color: string;
  w: number;
  h: number;
  x: number;
  y: number;
  subtreeH: number;
  children: LaidNode[];
}

export function makeLaid(
  node: MindNode,
  el: HTMLElement,
  color: string,
): LaidNode {
  return { node, el, color, w: 0, h: 0, x: 0, y: 0, subtreeH: 0, children: [] };
}

const V_GAP = 12;
const PADDING = 40;

/**
 * Edge length per level, and the length every level past the last one takes.
 * Uneven on purpose: the first steps in are the ones that have to read, and
 * they are where most maps live. The last value has to keep fitting a branch
 * node's collapse handle, which stands in this gap.
 */
const H_GAPS = [72, 56, 44, 40];

function gapAt(level: number): number {
  return H_GAPS[Math.min(level, H_GAPS.length - 1)]!;
}

/**
 * Left-to-right tidy tree layout for variable-size nodes. Nodes must already
 * be in the DOM so offsetWidth/offsetHeight are measurable.
 */
export function layoutTree(root: LaidNode): { width: number; height: number } {
  measure(root);
  computeSubtreeHeight(root);
  place(root, columnsFor(root), 0, PADDING);
  const bounds = { width: 0, height: 0 };

  collectBounds(root, bounds);

  return { width: bounds.width + PADDING, height: bounds.height + PADDING };
}

/**
 * Where each level starts, from the widest node on the level before it: a
 * shared left edge is how a tree says "same depth", and nothing drawn on the
 * nodes says it instead. A node's own width then only lengthens its own edge,
 * so one long label no longer shifts everything under it out of line.
 */
function columnsFor(root: LaidNode): number[] {
  const widest: number[] = [];
  const walk = (laid: LaidNode, level: number): void => {
    widest[level] = Math.max(widest[level] ?? 0, laid.w);
    for (const c of laid.children) {
      walk(c, level + 1);
    }
  };

  walk(root, 0);
  const xs = [PADDING];

  for (let level = 1; level < widest.length; level++) {
    xs[level] = xs[level - 1]! + widest[level - 1]! + gapAt(level - 1);
  }

  return xs;
}

function measure(laid: LaidNode): void {
  laid.w = laid.el.offsetWidth;
  laid.h = laid.el.offsetHeight;
  for (const c of laid.children) {
    measure(c);
  }
}

function computeSubtreeHeight(laid: LaidNode): number {
  if (!laid.children.length) {
    laid.subtreeH = laid.h;

    return laid.subtreeH;
  }
  let sum = V_GAP * (laid.children.length - 1);

  for (const c of laid.children) {
    sum += computeSubtreeHeight(c);
  }
  laid.subtreeH = Math.max(laid.h, sum);

  return laid.subtreeH;
}

function place(
  laid: LaidNode,
  columns: number[],
  level: number,
  top: number,
): void {
  laid.x = columns[level]!;
  laid.y = top + (laid.subtreeH - laid.h) / 2;
  if (!laid.children.length) {
    return;
  }
  let childBlock = V_GAP * (laid.children.length - 1);

  for (const c of laid.children) {
    childBlock += c.subtreeH;
  }
  let cy = top + (laid.subtreeH - childBlock) / 2;

  for (const c of laid.children) {
    place(c, columns, level + 1, cy);
    cy += c.subtreeH + V_GAP;
  }
}

function collectBounds(
  laid: LaidNode,
  bounds: { width: number; height: number },
): void {
  bounds.width = Math.max(bounds.width, laid.x + laid.w);
  bounds.height = Math.max(bounds.height, laid.y + laid.h);
  for (const child of laid.children) {
    collectBounds(child, bounds);
  }
}
