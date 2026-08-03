import { BodyLine, MindNode } from '../parse/parser';
import { multiLineValue } from './edit-value';

/** A body edit, pointed at the file as it is now. */
export interface Relocated {
  node: MindNode;
  anchor: number;
}

/**
 * Finds the run again in a freshly parsed tree. The map holds off re-parsing
 * while an edit is open, so by the time it is saved the file may have moved
 * under it - a line added in the Markdown pane is enough. Line numbers cannot
 * survive that; the text can, so it is what the run is found by.
 *
 * Nothing is guessed: the node must have the same text, and its run the same
 * lines, or the edit is refused rather than written somewhere it might not
 * belong.
 */
export function relocateBodyEdit(
  root: MindNode,
  node: MindNode,
  run: BodyLine[],
): Relocated | null {
  // What the run says, as an editor would show it: the blank lines that end a
  // run are its gap to whatever follows, not text anyone typed, and an editor
  // hands back neither.
  const wanted = multiLineValue(run.map((b) => b.text).join('\n'));
  const found: Relocated[] = [];
  const visit = (n: MindNode): void => {
    if (sameNode(n, node)) {
      for (const start of runStarts(n)) {
        if (multiLineValue(runText(n, start)) === wanted) {
          found.push({ node: n, anchor: start });
        }
      }
    }
    n.children.forEach(visit);
  };

  visit(root);

  return pick(
    found,
    node,
    run[0]?.line,
    (one) => one.node,
    (one) => one.anchor,
  );
}

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

/** The first line of each consecutive stretch of the node's own text. */
function runStarts(node: MindNode): number[] {
  return node.body
    .filter((b, i) => i === 0 || b.line !== (node.body[i - 1]?.line ?? 0) + 1)
    .map((b) => b.line);
}

/** The text of the run beginning at `start`. */
function runText(node: MindNode, start: number): string {
  const from = node.body.findIndex((b) => b.line === start);
  const out: string[] = [];

  for (let i = from; i < node.body.length; i++) {
    const line = node.body[i]!;

    if (i > from && line.line !== (node.body[i - 1]?.line ?? 0) + 1) {
      break;
    }
    out.push(line.text);
  }

  return out.join('\n');
}
