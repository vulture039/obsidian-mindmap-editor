import { FENCE_RE, HEADING_RE, LIST_RE } from './patterns';

export type NodeType = 'root' | 'heading' | 'list';

export interface MindNode {
  type: NodeType;
  text: string;
  /** 0-based line in the source file; -1 for the root node. */
  line: number;
  /** Last 0-based line of this node's subtree. */
  endLine: number;
  /**
   * Whether anything but blank lines sits under this node's own line - child
   * nodes or body text. What Obsidian can fold, so what the map can collapse.
   */
  foldable: boolean;
  /** Heading level (1-6) or list nesting depth (0-based). 0 for root. */
  level: number;
  /** Leading whitespace (list items only). */
  indent: string;
  /** List bullet: '-', '*', '+', '1.', ... */
  marker: string;
  /** true/false for task items, null for plain nodes. */
  checked: boolean | null;
  children: MindNode[];
  parent: MindNode | null;
}

function indentWidth(text: string): number {
  let width = 0;

  for (const ch of text) {
    width += ch === '\t' ? 4 : 1;
  }

  return width;
}

export function parseMarkdown(text: string, rootText: string): MindNode {
  const lines = text.split('\n');
  const lastLine = lines.length - 1;
  const root: MindNode = {
    type: 'root',
    text: rootText,
    line: -1,
    endLine: lastLine,
    foldable: false,
    level: 0,
    indent: '',
    marker: '',
    checked: null,
    children: [],
    parent: null,
  };
  const headingStack: MindNode[] = [root];
  let listStack: { width: number; node: MindNode }[] = [];
  let inFence = false;
  let start = 0;

  if (lines[0] === '---') {
    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];

      if (line === '---' || line === '...') {
        start = j + 1;
        break;
      }
    }
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';

    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);

    if (headingMatch) {
      const level = (headingMatch[1] ?? '').length;

      while (
        headingStack.length > 1 &&
        (headingStack[headingStack.length - 1]?.level ?? 0) >= level
      ) {
        headingStack.pop();
      }
      const parent = headingStack[headingStack.length - 1] ?? root;
      const node: MindNode = {
        type: 'heading',
        text: (headingMatch[2] ?? '').trim(),
        line: i,
        endLine: i,
        foldable: false,
        level,
        indent: '',
        marker: '',
        checked: null,
        children: [],
        parent,
      };

      parent.children.push(node);
      headingStack.push(node);
      listStack = [];
      continue;
    }

    const listMatch = LIST_RE.exec(line);

    if (listMatch) {
      const indent = listMatch[1] ?? '';
      const width = indentWidth(indent);

      while (
        listStack.length &&
        (listStack[listStack.length - 1]?.width ?? 0) >= width
      ) {
        listStack.pop();
      }
      const parent = listStack.length
        ? (listStack[listStack.length - 1]?.node ?? root)
        : (headingStack[headingStack.length - 1] ?? root);
      const node: MindNode = {
        type: 'list',
        text: (listMatch[4] ?? '').trim(),
        line: i,
        endLine: i,
        foldable: false,
        level: listStack.length,
        indent,
        marker: listMatch[2] ?? '-',
        checked: listMatch[3] === undefined ? null : listMatch[3] !== ' ',
        children: [],
        parent,
      };

      parent.children.push(node);
      listStack.push({ width, node });
    } else if (listStack.length && line.trim() !== '') {
      // A continuation line under the innermost open list item (e.g. a
      // description paragraph indented under a bullet, with no marker
      // of its own). It isn't parsed into its own node, but it must
      // stay inside the item's endLine range so move/reorder/delete
      // carry it along instead of stranding it at its old position.
      const top = listStack[listStack.length - 1];
      const leadingWs = /^\s*/.exec(line)?.[0] ?? '';

      if (top && indentWidth(leadingWs) > top.width) {
        top.node.endLine = i;
      }
    }
  }

  computeEndLines(root, lastLine);
  markFoldable(root, lines);

  return root;
}

function computeEndLines(root: MindNode, lastLine: number): void {
  // Pre-order traversal yields document order; a heading section ends just
  // before the next heading at an equal or shallower level. A stack over
  // still-open sections closes them in a single O(n) pass.
  const open: MindNode[] = [];
  const visit = (n: MindNode): void => {
    if (n.type === 'heading') {
      while ((open[open.length - 1]?.level ?? 0) >= n.level) {
        const closed = open.pop();

        if (closed) {
          closed.endLine = n.line - 1;
        }
      }
      open.push(n);
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);
  for (const heading of open) {
    heading.endLine = lastLine;
  }
  const fixLists = (n: MindNode): void => {
    for (const c of n.children) {
      fixLists(c);
    }
    if (n.type === 'list') {
      // Start from the node's own endLine, not just its line: the main
      // pass may have already extended it to cover a trailing
      // continuation/description line with no marker of its own.
      let end = n.endLine;

      for (const c of n.children) {
        end = Math.max(end, c.endLine);
      }
      n.endLine = end;
    }
  };

  fixLists(root);
}

/** Marks the nodes that hide something; blank lines alone do not count. */
function markFoldable(root: MindNode, lines: string[]): void {
  const visit = (n: MindNode): void => {
    for (let i = n.line + 1; i <= n.endLine && !n.foldable; i++) {
      n.foldable = (lines[i] ?? '').trim() !== '';
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  for (const c of root.children) {
    visit(c);
  }
}

/**
 * Whether the line still parses to this node (same type, level/indent, text).
 * Checked state is deliberately ignored so a checkbox node still matches its
 * line right after a toggle. Used to detect stale line numbers before an op
 * writes to the file.
 */
export function lineMatchesNode(line: string, node: MindNode): boolean {
  if (node.type === 'root') {
    return true;
  }
  if (node.type === 'heading') {
    const h = HEADING_RE.exec(line);

    return (
      !!h &&
      (h[1] ?? '').length === node.level &&
      (h[2] ?? '').trim() === node.text
    );
  }
  const m = LIST_RE.exec(line);

  return (
    !!m && (m[1] ?? '') === node.indent && (m[4] ?? '').trim() === node.text
  );
}

export function findByLine(root: MindNode, line: number): MindNode | null {
  if (root.line === line) {
    return root;
  }
  for (const c of root.children) {
    const found = findByLine(c, line);

    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Deepest node whose line range covers `line`. Unlike findByLine this also
 * answers for lines that are not a node's own first line - a heading's body,
 * a wrapped list item, a description paragraph - which is what an editor
 * cursor usually sits on.
 */
export function findEnclosing(root: MindNode, line: number): MindNode | null {
  let found: MindNode | null = null;
  const visit = (n: MindNode): void => {
    if (line < n.line || line > n.endLine) {
      return;
    }
    if (n.type !== 'root') {
      found = n;
    }
    for (const c of n.children) {
      visit(c);
    }
  };

  visit(root);

  return found;
}

export function isDescendantOrSelf(
  node: MindNode,
  ancestor: MindNode,
): boolean {
  let cur: MindNode | null = node;

  while (cur) {
    if (cur === ancestor) {
      return true;
    }
    cur = cur.parent;
  }

  return false;
}

export function maxHeadingLevel(node: MindNode): number {
  let max = node.type === 'heading' ? node.level : 0;

  for (const c of node.children) {
    max = Math.max(max, maxHeadingLevel(c));
  }

  return max;
}
