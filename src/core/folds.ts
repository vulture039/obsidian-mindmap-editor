import { MindNode } from './parse/parser';

/** One folded region as Obsidian stores it: 0-based lines, both inclusive. */
export interface FoldRange {
  from: number;
  to: number;
}

/** Which of the two folds an operation is about. */
export enum FoldKind {
  Branches = 'branches',
  Text = 'text',
}

/** Lines of the nodes a branch fold hides children of. */
export function branchTargets(root: MindNode): number[] {
  return targets(root, (n) => n.children.length > 0);
}

/** Lines of the nodes a text fold hides the own text of. */
export function textTargets(root: MindNode): number[] {
  return targets(root, (n) => n.body.length > 0);
}

/**
 * The note itself is a node like any other on the map: its branch folds, and
 * the prose above its first heading folds with the same handle. It has no line
 * in the file, so nothing about it reaches the editor - `mergeFolds` starts at
 * its children - but the map has to keep what it was told.
 */
function targets(root: MindNode, wanted: (n: MindNode) => boolean): number[] {
  const lines: number[] = [];
  const visit = (n: MindNode): void => {
    if (wanted(n)) {
      lines.push(n.line);
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);

  return lines;
}

/**
 * What a fold on this node's line means. One fold per line hides everything
 * under it, so a node with children can only ever mean its branch.
 */
function foldedKind(node: MindNode): FoldKind | null {
  if (node.children.length > 0) {
    return FoldKind.Branches;
  }

  return node.body.length > 0 ? FoldKind.Text : null;
}

/** The map state these folds stand for; a fold on any other line is dropped. */
export function collapsedFromFolds(
  root: MindNode,
  folds: FoldRange[],
): { branches: Set<number>; text: Set<number> } {
  const starts = new Set(folds.map((f) => f.from));
  const branches = new Set<number>();
  const text = new Set<number>();
  const visit = (n: MindNode): void => {
    if (n.type !== 'root' && starts.has(n.line)) {
      const kind = foldedKind(n);

      if (kind === FoldKind.Branches) {
        branches.add(n.line);
      } else if (kind === FoldKind.Text) {
        text.add(n.line);
      }
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);

  return { branches, text };
}

/**
 * The fold set the editor should show. Obsidian's own range beats one derived
 * from `endLine`; folds with no node behind them pass through untouched.
 */
export function mergeFolds(
  root: MindNode,
  branches: Set<number>,
  text: Set<number>,
  existing: FoldRange[],
): FoldRange[] {
  const byStart = new Map(existing.map((f) => [f.from, f]));
  const ours = new Set([...branchTargets(root), ...textTargets(root)]);
  const merged = existing.filter((f) => !ours.has(f.from));
  const visit = (n: MindNode): void => {
    const kind = foldedKind(n);
    const folded =
      kind === FoldKind.Branches
        ? branches.has(n.line)
        : kind === FoldKind.Text && text.has(n.line);

    if (folded) {
      merged.push(byStart.get(n.line) ?? { from: n.line, to: n.endLine });
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  for (const c of root.children) {
    visit(c);
  }

  return merged.sort((a, b) => a.from - b.from);
}

/** Drops folded lines a re-parse left without anything to fold. */
export function pruneLines(lines: Set<number>, keep: number[]): Set<number> {
  const known = new Set(keep);

  return new Set([...lines].filter((line) => known.has(line)));
}

/** Comparable form of a fold set, for spotting changes in the editor. */
export function foldsKey(folds: FoldRange[]): string {
  return folds
    .map((f) => `${f.from}:${f.to}`)
    .sort()
    .join(',');
}

export function sameLines(a: Set<number>, b: Set<number>): boolean {
  return a.size === b.size && [...a].every((line) => b.has(line));
}
