import { describe, it, expect } from 'vitest';
import { MindNode, parseMarkdown } from '../parse/parser';
import {
  addChildOp,
  addSiblingOp,
  deleteNodeOp,
  moveNodeOp,
  reorderSiblingOp,
  setCheckboxOp,
  setTextOp,
  toggleTaskOp,
} from './ops';

/** Parse `text`, exposing the root and a fresh mutable line array. */
function setup(text: string): { root: MindNode; lines: string[] } {
  return { root: parseMarkdown(text, 'Note'), lines: text.split('\n') };
}

describe('setCheckboxOp', () => {
  it('writes the requested state rather than flipping', () => {
    const { root, lines } = setup('- [ ] a');
    const node = root.children[0]!;

    expect(setCheckboxOp(lines.slice(), node, true)[0]).toBe('- [x] a');
    // Idempotent: asking for checked again keeps it checked.
    expect(setCheckboxOp(['- [x] a'], node, true)[0]).toBe('- [x] a');
    expect(setCheckboxOp(['- [x] a'], node, false)[0]).toBe('- [ ] a');
  });

  it('throws on a non-task line', () => {
    const { root, lines } = setup('- a');

    expect(() => setCheckboxOp(lines, root.children[0]!, true)).toThrow();
  });
});

describe('setTextOp', () => {
  it('renames a heading and keeps its level', () => {
    const { root, lines } = setup('## Old');

    expect(setTextOp(lines, root.children[0]!, 'New')[0]).toBe('## New');
  });

  it('renames a list item and keeps indent, marker, and checkbox', () => {
    const { root, lines } = setup('  - [ ] old');

    expect(setTextOp(lines, root.children[0]!, 'new')[0]).toBe('  - [ ] new');
  });
});

describe('toggleTaskOp', () => {
  it('adds a checkbox to a plain item', () => {
    const { root, lines } = setup('- a');

    expect(toggleTaskOp(lines, root.children[0]!)[0]).toBe('- [ ] a');
  });

  it('removes a checkbox, keeping the text', () => {
    const { root, lines } = setup('- [x] a');

    expect(toggleTaskOp(lines, root.children[0]!)[0]).toBe('- a');
  });
});

describe('addSiblingOp', () => {
  it('inserts an empty sibling after the node subtree', () => {
    const { root, lines } = setup('- a\n- b');
    const { lines: out, insertedLine } = addSiblingOp(lines, root.children[0]!);

    expect(insertedLine).toBe(1);
    expect(out[1]).toBe('- ');
  });

  it('forces a task sibling when asked', () => {
    const { root, lines } = setup('- a');

    expect(addSiblingOp(lines, root.children[0]!, true).lines[1]).toBe(
      '- [ ] ',
    );
  });

  it('adds a heading sibling at the same level', () => {
    const { root, lines } = setup('## A');

    expect(addSiblingOp(lines, root.children[0]!).lines[1]).toBe('## ');
  });
});

describe('addChildOp', () => {
  it('adds a heading child under the root when headings exist', () => {
    const { root, lines } = setup('# A');
    const { lines: out, insertedLine } = addChildOp(lines, root);

    expect(out[insertedLine]).toBe('# ');
  });

  it('adds a list child under the root when there are no headings', () => {
    const { root, lines } = setup('- a');
    const { lines: out, insertedLine } = addChildOp(lines, root);

    expect(out[insertedLine]).toBe('- ');
  });

  it('adds an indented list child under a list item', () => {
    const { root, lines } = setup('- a');
    const { lines: out, insertedLine } = addChildOp(lines, root.children[0]!);

    expect(out[insertedLine]).toBe('\t- ');
  });
});

describe('deleteNodeOp', () => {
  it('removes the node and its whole subtree', () => {
    const { root, lines } = setup('- a\n  - b\n- c');

    expect(deleteNodeOp(lines, root.children[0]!)).toEqual(['- c']);
  });
});

describe('reorderSiblingOp', () => {
  it('swaps two adjacent siblings, carrying subtrees', () => {
    const { root, lines } = setup('- a\n  - a1\n- b');
    const [a, b] = root.children;

    expect(reorderSiblingOp(lines, a!, b!)).toEqual(['- b', '- a', '  - a1']);
  });
});

describe('moveNodeOp', () => {
  it('reparents a list item, re-indenting it under the target', () => {
    const { root, lines } = setup('- a\n- b');
    const [a, b] = root.children;

    expect(moveNodeOp(lines, b!, a!)).toEqual(['- a', '\t- b']);
  });

  it('shifts heading levels when moving to the root', () => {
    const { root, lines } = setup('# A\n## B');
    const b = root.children[0]!.children[0]!;

    expect(moveNodeOp(lines, b, root)).toEqual(['# A', '# B']);
  });

  it('inserts before a given sibling', () => {
    const { root, lines } = setup('- a\n- b\n- c');
    const [a, , c] = root.children;

    expect(moveNodeOp(lines, c!, root, a)).toEqual(['- c', '- a', '- b']);
  });

  it('throws when the source line no longer matches (stale map)', () => {
    const { root } = setup('- a');

    expect(() => deleteNodeOp(['# changed'], root.children[0]!)).toThrow();
  });
});
