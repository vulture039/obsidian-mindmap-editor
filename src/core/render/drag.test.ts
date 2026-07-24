import { describe, it, expect } from 'vitest';
import { MindNode, parseMarkdown } from '../parser';
import { canDrop, canDropAsSibling } from './drag';

/** Root plus a line -> node lookup for the parsed tree. */
function tree(text: string): (line: number) => MindNode {
  const root = parseMarkdown(text, 'Note');
  const byLine = new Map<number, MindNode>();
  const walk = (n: MindNode): void => {
    byLine.set(n.line, n);
    n.children.forEach(walk);
  };

  walk(root);

  return (line) => byLine.get(line)!;
}

describe('canDrop', () => {
  it('rejects dropping a node onto itself or a descendant', () => {
    const at = tree('- a\n  - b');
    const a = at(0);
    const b = at(1);

    expect(canDrop(a, a)).toBe(false);
    expect(canDrop(a, b)).toBe(false);
    expect(canDrop(b, a)).toBe(true);
  });

  it('rejects a heading dropped into a list item', () => {
    const at = tree('# H\n- a');

    expect(canDrop(at(0), at(1))).toBe(false);
  });

  it('rejects a move that would push headings past level 6', () => {
    // Heading chain h1>h2>h3; dropping the h1 subtree under an h5 would make
    // its deepest heading h7, which is invalid.
    const at = tree('# a\n## b\n### c\n#### d\n##### e');
    const h1 = at(0);
    const h5 = at(4);

    expect(canDrop(h1, h5)).toBe(false);
  });

  it('allows a normal reparent', () => {
    const at = tree('# a\n# b');

    expect(canDrop(at(1), at(0))).toBe(true);
  });
});

describe('canDropAsSibling', () => {
  it('allows a same-type sibling with a valid parent', () => {
    const at = tree('- a\n- b');

    expect(canDropAsSibling(at(1), at(0))).toBe(true);
  });

  it('rejects mixing types (heading next to a list item)', () => {
    const at = tree('# H\n- a');

    // Trying to place the heading as a sibling of the list item.
    expect(canDropAsSibling(at(0), at(1))).toBe(false);
  });
});
