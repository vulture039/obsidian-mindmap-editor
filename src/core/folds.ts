/** One folded region as Obsidian stores it: 0-based lines, both inclusive. */
export interface FoldRange {
  from: number;
  to: number;
}

import { MindNode } from './parser';

/** Hides children, and has a line of its own to fold. */
export function isCollapsible(node: MindNode): boolean {
  return node.type !== 'root' && node.children.length > 0;
}

/** Lines of every node that can be collapsed. */
function collapsibleLines(root: MindNode): Set<number> {
  const lines = new Set<number>();
  const visit = (n: MindNode): void => {
    if (isCollapsible(n)) {
      lines.add(n.line);
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);

  return lines;
}

/** The nodes these folds collapse; a fold on any other line is dropped. */
export function collapsedFromFolds(
  root: MindNode,
  folds: FoldRange[],
): Set<number> {
  const starts = new Set(folds.map((f) => f.from));
  const collapsed = new Set<number>();

  for (const line of collapsibleLines(root)) {
    if (starts.has(line)) {
      collapsed.add(line);
    }
  }

  return collapsed;
}

/** Drops collapsed lines that no longer start a collapsible node. */
export function pruneCollapsed(
  root: MindNode,
  collapsed: Set<number>,
): Set<number> {
  const known = collapsibleLines(root);

  return new Set([...collapsed].filter((line) => known.has(line)));
}

/** Comparable form of a fold set, for spotting changes in the editor. */
export function foldsKey(folds: FoldRange[]): string {
  return folds
    .map((f) => `${f.from}:${f.to}`)
    .sort()
    .join(',');
}

export function sameLines(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const line of a) {
    if (!b.has(line)) {
      return false;
    }
  }

  return true;
}
