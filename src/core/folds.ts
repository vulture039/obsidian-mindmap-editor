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

/** Drops collapsed lines that no longer start a collapsible node. */
export function pruneCollapsed(
  root: MindNode,
  collapsed: Set<number>,
): Set<number> {
  const known = collapsibleLines(root);

  return new Set([...collapsed].filter((line) => known.has(line)));
}
