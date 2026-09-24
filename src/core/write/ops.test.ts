import { describe, it, expect } from 'vitest';
import { MindNode, parseMarkdown } from '../parse/parser';
import {
  addChildOp,
  addSiblingOp,
  addTaskNoteOp,
  deleteNodeOp,
  deleteNodesOp,
  moveNodeOp,
  moveNodesOp,
  reorderSiblingOp,
  setCheckboxOp,
  setTaskTreeCheckboxOp,
  syncTaskParentsOp,
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

describe('setTaskTreeCheckboxOp', () => {
  it('checks and unchecks every descendant task with its parent', () => {
    const { root, lines } = setup(
      '- [ ] parent\n\t- [ ] child\n\t\t- [x] grandchild\n\t- plain',
    );
    const parent = root.children[0]!;

    expect(setTaskTreeCheckboxOp(lines, parent, true)).toEqual([
      '- [x] parent',
      '\t- [x] child',
      '\t\t- [x] grandchild',
      '\t- plain',
    ]);
    expect(setTaskTreeCheckboxOp(lines, parent, false)).toEqual([
      '- [ ] parent',
      '\t- [ ] child',
      '\t\t- [ ] grandchild',
      '\t- plain',
    ]);
  });

  it('checks an ancestor only after all sibling tasks are done', () => {
    const { root, lines } = setup(
      '- [ ] parent\n\t- [x] first\n\t- [ ] second',
    );
    const parent = root.children[0]!;
    const second = parent.children[1]!;

    expect(setTaskTreeCheckboxOp(lines, second, true)).toEqual([
      '- [x] parent',
      '\t- [x] first',
      '\t- [x] second',
    ]);
  });

  it('syncs through a non-task structural node', () => {
    const { root, lines } = setup(
      '- [x] parent\n\t- group\n\t\t- [x] nested\n\t- [x] sibling',
    );
    const parent = root.children[0]!;
    const nested = parent.children[0]!.children[0]!;

    expect(setTaskTreeCheckboxOp(lines, nested, false)[0]).toBe('- [ ] parent');
  });
});

describe('syncTaskParentsOp', () => {
  it('applies parent updates from deepest to shallowest', () => {
    const { root, lines } = setup(
      '- [x] parent\n\t- [x] child\n\t\t- [ ] grandchild',
    );
    const child = root.children[0]!.children[0]!;
    const parent = root.children[0]!;

    expect(
      syncTaskParentsOp(lines, [
        { node: child, checked: false },
        { node: parent, checked: false },
      ]),
    ).toEqual(['- [ ] parent', '\t- [ ] child', '\t\t- [ ] grandchild']);
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

describe('addTaskNoteOp', () => {
  it('inserts an indented continuation line before child tasks', () => {
    const { root, lines } = setup('- [ ] task\n  - [ ] child');

    expect(addTaskNoteOp(lines, root.children[0]!)).toEqual({
      lines: ['- [ ] task', '  ', '  - [ ] child'],
      insertedLine: 1,
    });
  });

  it('refuses a note on a plain list item', () => {
    const { root, lines } = setup('- plain');

    expect(() => addTaskNoteOp(lines, root.children[0]!)).toThrow();
  });
});

describe('deleteNodeOp', () => {
  it('removes the node and its whole subtree', () => {
    const { root, lines } = setup('- a\n  - b\n- c');

    expect(deleteNodeOp(lines, root.children[0]!)).toEqual(['- c']);
  });
});

describe('deleteNodesOp', () => {
  it('removes multiple sibling subtrees in one operation', () => {
    const { root, lines } = setup('- a\n  - a1\n- b\n- c');
    const [a, , c] = root.children;

    expect(deleteNodesOp(lines, [c!, a!])).toEqual(['- b']);
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

  it('reparents a rendered-text heading with its complete body', () => {
    const text = [
      '# Structure',
      '## Rendered node text',
      '',
      '**bold** and ![[Assets/Preview.svg]]',
      '',
      '![Remote](https://example.com/image.png)',
      '## Body text',
      '# Second section',
    ].join('\n');
    const { root, lines } = setup(text);
    const structure = root.children[0]!;
    const rendered = structure.children[0]!;
    const body = structure.children[1]!;
    const out = moveNodeOp(lines, rendered, body);

    expect(out).toEqual([
      '# Structure',
      '## Body text',
      '### Rendered node text',
      '',
      '**bold** and ![[Assets/Preview.svg]]',
      '',
      '![Remote](https://example.com/image.png)',
      '# Second section',
    ]);
    const moved = parseMarkdown(out.join('\n'), 'Note').children[0]!
      .children[0]!.children[0]!;

    expect(moved.text).toBe('Rendered node text');
    expect(moved.level).toBe(3);
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

describe('moveNodesOp', () => {
  it('moves non-adjacent siblings together while preserving their order', () => {
    const { root, lines } = setup('- a\n  - a1\n- b\n- c\n- target');
    const [a, , c, target] = root.children;

    expect(moveNodesOp(lines, [c!, a!], target!)).toEqual([
      '- b',
      '- target',
      '  - a',
      '    - a1',
      '  - c',
    ]);
  });

  it('inserts a group before an earlier sibling', () => {
    const { root, lines } = setup('- a\n- b\n- c\n- d');
    const [, b, c, d] = root.children;

    expect(moveNodesOp(lines, [c!, d!], root, b)).toEqual([
      '- a',
      '- c',
      '- d',
      '- b',
    ]);
  });
});
