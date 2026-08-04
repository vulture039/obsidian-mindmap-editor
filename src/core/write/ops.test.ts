import { describe, it, expect } from 'vitest';
import { MindNode, parseMarkdown } from '../parse/parser';
import {
  addChildOp,
  addSiblingOp,
  bodyRunOf,
  deleteNodeOp,
  setBodyOp,
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

describe('setBodyOp', () => {
  it('rewrites an indented description and keeps its indent', () => {
    const { root, lines } = setup('- a\n  old text\n- b');

    expect(setBodyOp(lines, root.children[0]!, 'new text', 1)).toEqual([
      '- a',
      '  new text',
      '- b',
    ]);
  });

  it('keeps indentation inside the body relative to it', () => {
    const src = '# H\n  intro\n      code\n  tail';
    const { root, lines } = setup(src);
    const body = root.children[0]!.body.map((b) => b.text);

    // Only the shared indent is stripped, so the code block stays nested.
    expect(body).toEqual(['intro', '    code', 'tail']);
    expect(setBodyOp(lines, root.children[0]!, body.join('\n'), 1)).toEqual(
      src.split('\n'),
    );
  });

  it('round-trips a first line indented deeper than the rest', () => {
    const src = '# H\n      code\n  tail';
    const { root, lines } = setup(src);
    const body = root.children[0]!.body.map((b) => b.text);

    expect(body).toEqual(['    code', 'tail']);
    expect(setBodyOp(lines, root.children[0]!, body.join('\n'), 1)).toEqual(
      src.split('\n'),
    );
  });

  it('grows and shrinks the block, and removes it when emptied', () => {
    const { root, lines } = setup('- a\n  one\n- b');
    const node = root.children[0]!;

    expect(setBodyOp(lines.slice(), node, 'one\ntwo', 1)).toEqual([
      '- a',
      '  one',
      '  two',
      '- b',
    ]);
    expect(setBodyOp(lines.slice(), node, '', 1)).toEqual(['- a', '- b']);
  });

  it('adds text to a node that has none', () => {
    const { root, lines } = setup('- a\n- b');

    expect(setBodyOp(lines, root.children[0]!, 'fresh', 0)).toEqual([
      '- a',
      '\tfresh',
      '- b',
    ]);
  });

  it('indents new text under a heading at column zero', () => {
    const { root, lines } = setup('# H\n## Sub');

    expect(setBodyOp(lines, root.children[0]!, 'fresh', 0)).toEqual([
      '# H',
      'fresh',
      '## Sub',
    ]);
  });

  it('writes the lines it is given, blank ones included', () => {
    const { root, lines } = setup('# H\nold');

    // Trimming what the user typed is the editor's job, not this one's: a
    // blank line here is a line they can see.
    expect(setBodyOp(lines, root.children[0]!, '\none\n\ntwo', 1)).toEqual([
      '# H',
      '',
      'one',
      '',
      'two',
    ]);
  });

  it('writes an indented body that has a blank line in it', () => {
    const src = '- a\n  one\n\n  two\n- b';
    const { root } = setup(src);

    expect(
      setBodyOp(src.split('\n'), root.children[0]!, 'one\n\ntwo\nthree', 1),
    ).toEqual(['- a', '  one', '', '  two', '  three', '- b']);
  });

  it('refuses to write when the body line changed underneath', () => {
    const { root } = setup('- a\n  old text\n- b');

    expect(() =>
      setBodyOp(
        ['- a', '  someone else typed this', '- b'],
        root.children[0]!,
        'new',
        1,
      ),
    ).toThrow();
  });

  it('keeps the blank lines that hold a run apart from its neighbours', () => {
    const src = '# H\nintro\n\n- a\n\ntail';
    const { root } = setup(src);
    const heading = root.children[0]!;

    // The blank on either side of the item is part of the run that touches it.
    expect(setBodyOp(src.split('\n'), heading, 'edited', 1)).toEqual([
      '# H',
      'edited',
      '',
      '- a',
      '',
      'tail',
    ]);
    // ...and a run whose blank line the user removed keeps it removed.
    expect(setBodyOp(src.split('\n'), heading, 'edited', 5)).toEqual([
      '# H',
      'intro',
      '',
      '- a',
      'edited',
    ]);
  });

  it('writes only the run the edit was anchored in', () => {
    const src = '# H\nbefore\n- a\nafter';
    const { root } = setup(src);
    const heading = root.children[0]!;

    expect(heading.body.map((b) => b.text)).toEqual(['before', 'after']);
    // The run below the child grows without disturbing the one above it.
    expect(setBodyOp(src.split('\n'), heading, 'after\nmore', 3)).toEqual([
      '# H',
      'before',
      '- a',
      'after',
      'more',
    ]);
    // ...and the run above it stays put with the child right behind it.
    expect(setBodyOp(src.split('\n'), heading, 'edited', 1)).toEqual([
      '# H',
      'edited',
      '- a',
      'after',
    ]);
  });

  it('treats a blank line inside a run as part of it', () => {
    const src = '# H\none\n\ntwo';

    expect(bodyRunOf(parseMarkdown(src, 'Note').children[0]!, 1)).toHaveLength(
      3,
    );
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
