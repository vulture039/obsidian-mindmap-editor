import { FENCE_RE, HEADING_RE, LIST_RE } from './patterns';

export type NodeType = 'root' | 'heading' | 'list';

/** One line of a node's own text, keyed to the file line it came from. */
export interface BodyLine {
  line: number;
  text: string;
}

export interface MindNode {
  type: NodeType;
  text: string;
  /** 0-based line in the source file; -1 for the root node. */
  line: number;
  /** Last 0-based line of this node's subtree. */
  endLine: number;
  /**
   * The node's own text: the lines under it that no child covers, trimmed and
   * still carrying their file line, so the map can jump back to one. Lives
   * only in the editor unless the map draws it.
   */
  body: BodyLine[];
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
    body: [],
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
    const close = lines.findIndex(
      (line, j) => j > 0 && (line === '---' || line === '...'),
    );

    start = close > 0 ? close + 1 : 0;
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
        body: [],
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
        body: [],
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
  collectBodies(root, lines);

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

/**
 * The whitespace every non-blank line starts with. Body text is stored with
 * it removed, so what the map shows keeps the relative indentation inside a
 * description (a nested code block, say) and can be written back unchanged.
 */
export function commonIndent(texts: string[]): string {
  let common: string | null = null;

  for (const text of texts) {
    if (text.trim() === '') {
      continue;
    }
    const ws = /^\s*/.exec(text)?.[0] ?? '';

    if (common === null) {
      common = ws;
      continue;
    }
    let i = 0;

    while (i < common.length && i < ws.length && common[i] === ws[i]) {
      i++;
    }
    common = common.slice(0, i);
  }

  return common ?? '';
}

/**
 * Fills in each node's own text: its range minus every child's, blank lines at
 * either end dropped. What is left is what the map can fold and edit.
 */
function collectBodies(root: MindNode, lines: string[]): void {
  const visit = (n: MindNode): void => {
    const own: BodyLine[] = [];
    const take = (from: number, to: number): void => {
      for (let i = from; i <= to; i++) {
        own.push({ line: i, text: (lines[i] ?? '').trimEnd() });
      }
    };
    let next = n.line + 1;

    for (const c of n.children) {
      take(next, c.line - 1);
      next = Math.max(next, c.endLine + 1);
    }
    take(next, n.endLine);
    while (own.length && own[own.length - 1]?.text === '') {
      own.pop();
    }
    while (own.length && own[0]?.text === '') {
      own.shift();
    }
    const indent = commonIndent(own.map((b) => b.text));

    for (const b of own) {
      b.text = b.text.startsWith(indent) ? b.text.slice(indent.length) : b.text;
    }
    n.body = own;
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
