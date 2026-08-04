import { MindNode } from '../parse/parser';

/**
 * Finds a node again in a freshly parsed tree, by what it says rather than by
 * where it was: the map's line numbers are from its last render, and the file
 * may have moved on since. Where two nodes say the same thing and neither is
 * still at the old line, it gives up rather than pick one.
 */
export function relocateNode(root: MindNode, node: MindNode): MindNode | null {
  const found: MindNode[] = [];
  const visit = (n: MindNode): void => {
    if (sameNode(n, node)) {
      found.push(n);
    }
    n.children.forEach(visit);
  };

  visit(root);

  return pick(
    found,
    node,
    node.line,
    (n) => n,
    (n) => n.line,
  );
}

/**
 * Which candidate the write belongs to. Where several say the same thing, what
 * is under them decides before the old line does: a twin that has moved onto
 * that line would otherwise take the write. Two that are alike all the way up
 * cannot be told apart at all, and only the old line is left to go on.
 */
function pick<T>(
  found: T[],
  node: MindNode,
  was: number | undefined,
  nodeOf: (one: T) => MindNode,
  lineOf: (one: T) => number,
): T | null {
  if (found.length < 2) {
    return found[0] ?? null;
  }
  const onPath = found.filter((one) => samePath(nodeOf(one), node));
  const best = onPath.length ? onPath : found;

  return best.length === 1
    ? best[0]!
    : (best.find((one) => lineOf(one) === was) ?? null);
}

/** The same node with the same chain of ancestors above it. */
function samePath(a: MindNode, b: MindNode): boolean {
  let up: MindNode | null = a.parent;
  let other: MindNode | null = b.parent;

  while (up && other) {
    if (!sameNode(up, other)) {
      return false;
    }
    up = up.parent;
    other = other.parent;
  }

  return !up && !other;
}

/** The same node in another parse of the same note - by what it says, not where. */
function sameNode(a: MindNode, b: MindNode): boolean {
  if (a.type === 'root' || b.type === 'root') {
    return a.type === b.type;
  }

  return (
    a.type === b.type &&
    a.text === b.text &&
    a.level === b.level &&
    a.indent === b.indent
  );
}
