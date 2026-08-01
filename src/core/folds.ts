import { MindNode } from './parser';

/** One folded region as Obsidian stores it: 0-based lines, both inclusive. */
export interface FoldRange {
  from: number;
  to: number;
}

/** Hides something (children or body text), and has a line to fold. */
export function isCollapsible(node: MindNode): boolean {
  return node.type !== 'root' && node.foldable;
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

/** Lines the bulk fold acts on: body-only handles, or branch ones. */
export function foldTargets(root: MindNode, bodyOnly: boolean): number[] {
  const lines: number[] = [];
  const visit = (n: MindNode): void => {
    if (isCollapsible(n) && (n.children.length === 0) === bodyOnly) {
      lines.push(n.line);
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

/**
 * The fold set the editor should show. Obsidian's own range beats one derived
 * from `endLine`; folds with no node behind them pass through untouched.
 */
export function mergeFolds(
  root: MindNode,
  collapsed: Set<number>,
  existing: FoldRange[],
): FoldRange[] {
  const known = collapsibleLines(root);
  const byStart = new Map(existing.map((f) => [f.from, f]));
  const merged = existing.filter((f) => !known.has(f.from));
  const visit = (n: MindNode): void => {
    if (isCollapsible(n) && collapsed.has(n.line)) {
      merged.push(byStart.get(n.line) ?? { from: n.line, to: n.endLine });
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);

  return merged.sort((a, b) => a.from - b.from);
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
