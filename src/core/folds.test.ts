import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parse/parser';
import {
  branchTargets,
  collapsedFromFolds,
  foldsKey,
  mergeFolds,
  pruneLines,
  sameLines,
  textTargets,
} from './folds';

// 0 '# A'
// 1 '- a'
// 2 '  - a1'
// 3 '# B'
// 4 'text under B'
const NOTE = '# A\n- a\n  - a1\n# B\ntext under B';

describe('branchTargets / textTargets', () => {
  it('splits the nodes with children from the ones with text', () => {
    const root = parseMarkdown(NOTE, 'Note');

    // The note itself is line -1: it has children, so it folds like any other.
    // 0 "# A" and 1 "- a" have children; 3 "# B" only body text.
    expect(branchTargets(root)).toEqual([-1, 0, 1]);
    expect(textTargets(root)).toEqual([3]);
  });

  it('counts a node that has both', () => {
    const root = parseMarkdown('# A\nintro\n- a', 'Note');

    expect(branchTargets(root)).toEqual([-1, 0]);
    expect(textTargets(root)).toEqual([0]);
  });

  it('counts the note itself for the prose above its first heading', () => {
    const root = parseMarkdown('loose\n\n# A', 'Note');

    expect(textTargets(root)).toEqual([-1]);
  });

  it('skips nodes that hide nothing, blank lines included', () => {
    const root = parseMarkdown('- a\n- b\n\n', 'Note');

    expect(branchTargets(root)).toEqual([-1]);
    expect(textTargets(root)).toEqual([]);
  });
});

describe('collapsedFromFolds', () => {
  it('reads a fold as a branch fold where there are children', () => {
    const root = parseMarkdown(NOTE, 'Note');
    const { branches, text } = collapsedFromFolds(root, [
      { from: 0, to: 2 },
      { from: 1, to: 2 },
    ]);

    expect([...branches]).toEqual([0, 1]);
    expect(text.size).toBe(0);
  });

  it('reads it as a text fold where there are none', () => {
    const root = parseMarkdown(NOTE, 'Note');
    const { branches, text } = collapsedFromFolds(root, [{ from: 3, to: 4 }]);

    expect(branches.size).toBe(0);
    expect([...text]).toEqual([3]);
  });

  it('reads a node with both as folded branch only', () => {
    const root = parseMarkdown('# A\nintro\n- a', 'Note');
    const { branches, text } = collapsedFromFolds(root, [{ from: 0, to: 2 }]);

    // Obsidian's fold hides the text too, but the map has no way back from
    // that to "the text is folded" - unfolding the branch shows both again.
    expect([...branches]).toEqual([0]);
    expect(text.size).toBe(0);
  });

  it('ignores folds with no node to collapse', () => {
    const root = parseMarkdown(NOTE, 'Note');
    const { branches, text } = collapsedFromFolds(root, [
      { from: 2, to: 2 },
      { from: 4, to: 4 },
    ]);

    expect(branches.size + text.size).toBe(0);
  });
});

describe('mergeFolds', () => {
  const none = new Set<number>();

  it('folds the collapsed branches, deriving the range from endLine', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set([0]), none, [])).toEqual([
      { from: 0, to: 2 },
    ]);
  });

  it("keeps the editor's own range for a line it already folds", () => {
    const root = parseMarkdown(NOTE, 'Note');
    const existing = [{ from: 0, to: 1 }];

    expect(mergeFolds(root, new Set([0]), none, existing)).toEqual(existing);
  });

  it('passes through folds the map has no node for', () => {
    const root = parseMarkdown(NOTE, 'Note');

    // Line 4 is body text: no node starts there, so the fold is not ours.
    expect(mergeFolds(root, none, none, [{ from: 4, to: 4 }])).toEqual([
      { from: 4, to: 4 },
    ]);
  });

  it('writes the text fold of a node with no children', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, none, new Set([3]), [])).toEqual([
      { from: 3, to: 4 },
    ]);
  });

  it('leaves the text fold of a node with children in the map', () => {
    const root = parseMarkdown('# A\nintro\n- a', 'Note');

    // Folding it in the editor would take the child with it, which is not
    // what the map is showing.
    expect(mergeFolds(root, none, new Set([0]), [])).toEqual([]);
  });

  it('drops the fold of a branch that is no longer collapsed', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, none, none, [{ from: 1, to: 2 }])).toEqual([]);
  });

  it('keeps a nested fold under a collapsed parent, in line order', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set([1, 0]), none, [])).toEqual([
      { from: 0, to: 2 },
      { from: 1, to: 2 },
    ]);
  });
});

describe('pruneLines', () => {
  it('drops lines that are no longer a target', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect([...pruneLines(new Set([0, 2, 42]), branchTargets(root))]).toEqual([
      0,
    ]);
  });
});

describe('foldsKey', () => {
  it('is order-independent and keyed by where each fold starts', () => {
    const a = [
      { from: 1, to: 2 },
      { from: 0, to: 3 },
    ];

    expect(foldsKey(a)).toBe(foldsKey([...a].reverse()));
    expect(foldsKey(a)).not.toBe(foldsKey([{ from: 0, to: 3 }]));
  });

  // The same two folds, read from the same file: the editor answers 47:65 and
  // 56:64, reading view 47:48 and 56:57. Keying on `to` made every switch
  // between the two panes look like the user had refolded the document.
  it('does not change when a pane reports `to` its own way', () => {
    const editing = [
      { from: 47, to: 65 },
      { from: 56, to: 64 },
    ];
    const reading = [
      { from: 47, to: 48 },
      { from: 56, to: 57 },
    ];

    expect(foldsKey(editing)).toBe(foldsKey(reading));
  });
});

describe('sameLines', () => {
  it('compares sets by content', () => {
    expect(sameLines(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameLines(new Set([1]), new Set([1, 2]))).toBe(false);
    expect(sameLines(new Set([1]), new Set([2]))).toBe(false);
  });
});
