import { isDescendantOrSelf, maxHeadingLevel, MindNode } from '../parse/parser';
import { LaidNode } from './layout';

/** Max distance (px) from the pointer to a node for snap reparenting. */
export const SNAP_DISTANCE = 60;

/**
 * What a drop at the pointer would do. `parent` null = reparent into
 * `laid.node` (pointer over the node's middle); otherwise insert into
 * `parent`'s children before `before` (pointer in the top/bottom third of a
 * same-type sibling; null `before` = at the end).
 */
export interface DropTarget {
  laid: LaidNode;
  parent: MindNode | null;
  before: MindNode | null;
}

/** Whether `source`'s subtree may become a child of `target`. */
export function canDrop(source: MindNode, target: MindNode): boolean {
  if (isDescendantOrSelf(target, source)) {
    return false;
  }
  if (source.type === 'heading' && target.type === 'list') {
    return false;
  }
  if (source.type === 'heading') {
    const targetLevel = target.type === 'root' ? 0 : target.level;
    const delta = targetLevel + 1 - source.level;

    if (delta > 0 && maxHeadingLevel(source) + delta > 6) {
      return false;
    }
  }

  return true;
}

/** Whether `source` could be inserted as a sibling next to `target`. */
export function canDropAsSibling(source: MindNode, target: MindNode): boolean {
  return (
    !!target.parent &&
    target.type === source.type &&
    canDrop(source, target.parent)
  );
}

/**
 * Resolves the drop the pointer is over, or null when it would leave the node
 * where it already is (or no node is within snapping distance).
 */
export function findDrop(
  laidByLine: Map<number, LaidNode>,
  sources: MindNode[],
  clientX: number,
  clientY: number,
): DropTarget | null {
  if (!sources.length) {
    return null;
  }
  let best: LaidNode | null = null;
  let bestRect: DOMRect | null = null;
  let bestDist = Infinity;

  for (const laid of laidByLine.values()) {
    if (sources.some((item) => isDescendantOrSelf(laid.node, item))) {
      continue;
    }
    const rect = laid.el.getBoundingClientRect();
    const dx = Math.max(rect.left - clientX, 0, clientX - rect.right);
    const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom);
    const dist = Math.hypot(dx, dy);

    if (dist < bestDist) {
      bestDist = dist;
      best = laid;
      bestRect = rect;
    }
  }
  if (!best || !bestRect || bestDist > SNAP_DISTANCE) {
    return null;
  }
  const target = best.node;
  const parent = target.parent;

  if (parent && sources.every((item) => canDropAsSibling(item, target))) {
    const sibs = parent.children;
    const isNoop = (before: MindNode | null): boolean => {
      if (sources.some((item) => item.parent !== parent)) {
        return false;
      }
      const selected = new Set(sources);
      const remaining = sibs.filter((item) => !selected.has(item));
      const at = before ? remaining.indexOf(before) : remaining.length;
      const moved = [...sources].sort(
        (a, b) => sibs.indexOf(a) - sibs.indexOf(b),
      );
      const result = [...remaining];

      result.splice(at < 0 ? result.length : at, 0, ...moved);

      return result.every((item, index) => item === sibs[index]);
    };

    if (clientY < bestRect.top + bestRect.height / 3) {
      return isNoop(target) ? null : { laid: best, parent, before: target };
    }
    if (clientY > bestRect.bottom - bestRect.height / 3) {
      const before = sibs[sibs.indexOf(target) + 1] ?? null;

      return isNoop(before) ? null : { laid: best, parent, before };
    }
  }
  if (sources.every((item) => canDrop(item, target))) {
    return { laid: best, parent: null, before: null };
  }

  return null;
}
