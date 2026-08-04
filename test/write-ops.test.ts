import { describe, it, expect } from 'vitest';
import {
  addChildOp,
  addSiblingOp,
  deleteNodeOp,
  moveNodeOp,
  reorderSiblingOp,
  setCheckboxOp,
  setTextOp,
  toggleTaskOp,
} from '../src/core/write/ops';
import { MindNode, parseMarkdown } from '../src/core/parse/parser';

/**
 * Every write the map can make, held to one rule: the lines it did not set
 * out to touch come out of it unchanged, text of their own included. A node
 * op that quietly rewrote a neighbour's description would be invisible until
 * the description was gone.
 */
const DOCS: Record<string, string> = {
  'items with descriptions':
    '- a\n  a text\n- b\n  b text\n  more\n- c\n  c text',
  'headings with text and lists':
    '# H\nintro\n- a\n  a text\n## I\ntail\n- b\n  b text',
  'tasks with text': '- [ ] a\n  a text\n- [x] b\n  b text',
  'nested items with text':
    '- a\n  a text\n  - b\n    b text\n    - c\n      c text\n- d',
  'blank lines between everything': '# H\n\nintro\n\n- a\n\n  a text\n\n- b\n',
};

/** Lines that are text of some node other than `node` and its subtree. */
function otherText(root: MindNode, node: MindNode): Map<number, string> {
  const out = new Map<number, string>();
  const visit = (n: MindNode): void => {
    const inside = n.line >= node.line && n.line <= node.endLine;

    if (!inside) {
      for (const b of n.body) {
        out.set(b.line, b.text);
      }
    }
    n.children.forEach(visit);
  };

  visit(root);

  return out;
}

/** Every node of the tree, in document order. */
function nodes(root: MindNode): MindNode[] {
  const out: MindNode[] = [];
  const visit = (n: MindNode): void => {
    if (n.type !== 'root') {
      out.push(n);
    }
    n.children.forEach(visit);
  };

  visit(root);

  return out;
}

/**
 * The text of every node the op was not aimed at is still in the file
 * afterwards, whatever line it ended up on.
 */
function keepsOtherText(before: string, node: MindNode, after: string[]): void {
  const root = parseMarkdown(before, 'Note');
  const wanted = [...otherText(root, node).values()].filter((t) => t !== '');
  const left = after.join('\n');

  for (const text of wanted) {
    expect(left, `lost: ${JSON.stringify(text)}`).toContain(text);
  }
}

describe('a write aimed at one node', () => {
  for (const [name, src] of Object.entries(DOCS)) {
    it(`leaves every other node's text alone: ${name}`, () => {
      for (const node of nodes(parseMarkdown(src, 'Note'))) {
        const lines = (): string[] => src.split('\n');

        keepsOtherText(src, node, setTextOp(lines(), node, 'renamed'));
        keepsOtherText(src, node, deleteNodeOp(lines(), node));
        keepsOtherText(src, node, addChildOp(lines(), node).lines);
        keepsOtherText(src, node, addSiblingOp(lines(), node).lines);
        keepsOtherText(src, node, toggleTaskOp(lines(), node));
        if (node.checked !== null) {
          keepsOtherText(src, node, setCheckboxOp(lines(), node, true));
        }
      }
    });

    it(`carries a node's own text with it when it moves: ${name}`, () => {
      const root = parseMarkdown(src, 'Note');

      for (const node of nodes(root)) {
        const sibs = node.parent?.children ?? [];
        const other = sibs[sibs.indexOf(node) + 1];

        if (other && other.type === node.type) {
          const after = reorderSiblingOp(src.split('\n'), node, other);

          keepsOtherText(src, node, after);
          for (const b of node.body) {
            expect(after.join('\n')).toContain(b.text);
          }
        }
        const target = nodes(root).find(
          (t) =>
            t !== node &&
            (t.line < node.line || t.line > node.endLine) &&
            t.type === 'list',
        );

        if (target) {
          const after = moveNodeOp(src.split('\n'), node, target);

          keepsOtherText(src, node, after);
          for (const b of node.body) {
            expect(after.join('\n'), `move lost ${b.text}`).toContain(b.text);
          }
        }
      }
    });
  }
});
