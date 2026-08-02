import { BodyLine, MindNode } from '../parse/parser';

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
  const wanted = run.map((b) => b.text).join('\n');
  const found: Relocated[] = [];
  const visit = (n: MindNode): void => {
    if (sameNode(n, node)) {
      for (const start of runStarts(n)) {
        if (runText(n, start) === wanted) {
          found.push({ node: n, anchor: start });
        }
      }
    }
    n.children.forEach(visit);
  };

  visit(root);
  const was = run[0]?.line;

  // Where it always was, if nothing moved; otherwise the one match there is.
  // Two nodes saying the same thing with the same text under them cannot be
  // told apart once the lines have shifted, and a guess there would write
  // into the wrong one.
  return (
    found.find((one) => one.anchor === was) ??
    (found.length === 1 ? found[0]! : null)
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

  return (
    found.find((n) => n.line === node.line) ??
    (found.length === 1 ? found[0]! : null)
  );
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
