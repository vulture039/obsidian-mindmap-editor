import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parser';
import {
  collapsedFromFolds,
  foldsKey,
  isCollapsible,
  mergeFolds,
  pruneCollapsed,
  sameLines,
} from './folds';

// 0 '# A'
// 1 '- a'
// 2 '  - a1'
// 3 '# B'
// 4 'text under B'
const NOTE = '# A\n- a\n  - a1\n# B\ntext under B';

describe('isCollapsible', () => {
  it('is true for nodes with children, never the root', () => {
    const root = parseMarkdown(NOTE, 'Note');
    const a = root.children[0]!;

    expect(isCollapsible(root)).toBe(false);
    expect(isCollapsible(a)).toBe(true);
    expect(isCollapsible(a.children[0]!.children[0]!)).toBe(false);
  });

  it('is true for a node whose only content is body text', () => {
    const root = parseMarkdown(NOTE, 'Note');
    const b = root.children[1]!;

    // "# B" has no child node, just the paragraph under it.
    expect(b.children).toHaveLength(0);
    expect(isCollapsible(b)).toBe(true);
    // A bullet's indented description counts the same way.
    expect(
      isCollapsible(parseMarkdown('- a\n  detail', 'N').children[0]!),
    ).toBe(true);
  });

  it('is false when only blank lines follow', () => {
    const root = parseMarkdown('# A\n\n\n# B', 'Note');

    expect(isCollapsible(root.children[0]!)).toBe(false);
  });
});

describe('collapsedFromFolds', () => {
  it('collapses the nodes the folds start on', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect([
      ...collapsedFromFolds(root, [
        { from: 0, to: 2 },
        { from: 1, to: 2 },
      ]),
    ]).toEqual([0, 1]);
  });

  it('collapses a node folded for its body text alone', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect([...collapsedFromFolds(root, [{ from: 3, to: 4 }])]).toEqual([3]);
  });

  it('ignores folds with no node to collapse', () => {
    const root = parseMarkdown(NOTE, 'Note');

    // Line 2 is a leaf bullet and line 4 is body text, not a node.
    expect(
      collapsedFromFolds(root, [
        { from: 2, to: 2 },
        { from: 4, to: 4 },
      ]).size,
    ).toBe(0);
  });
});

describe('mergeFolds', () => {
  it('folds the collapsed branches, deriving the range from endLine', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set([0]), [])).toEqual([{ from: 0, to: 2 }]);
  });

  it("keeps the editor's own range for a line it already folds", () => {
    const root = parseMarkdown(NOTE, 'Note');
    const existing = [{ from: 0, to: 1 }];

    expect(mergeFolds(root, new Set([0]), existing)).toEqual(existing);
  });

  it('passes through folds the map has no node for', () => {
    const root = parseMarkdown(NOTE, 'Note');

    // Line 4 is body text: no node starts there, so the fold is not ours.
    expect(mergeFolds(root, new Set(), [{ from: 4, to: 4 }])).toEqual([
      { from: 4, to: 4 },
    ]);
  });

  it('folds a body-only node with no children', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set([3]), [])).toEqual([{ from: 3, to: 4 }]);
  });

  it('drops the fold of a branch that is no longer collapsed', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set(), [{ from: 1, to: 2 }])).toEqual([]);
  });

  it('keeps a nested fold under a collapsed parent, in line order', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect(mergeFolds(root, new Set([1, 0]), [])).toEqual([
      { from: 0, to: 2 },
      { from: 1, to: 2 },
    ]);
  });
});

describe('pruneCollapsed', () => {
  it('drops lines that no longer start a branch', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect([...pruneCollapsed(root, new Set([0, 2, 42]))]).toEqual([0]);
  });
});

describe('foldsKey', () => {
  it('is order-independent and range-sensitive', () => {
    const a = [
      { from: 1, to: 2 },
      { from: 0, to: 3 },
    ];

    expect(foldsKey(a)).toBe(foldsKey([...a].reverse()));
    expect(foldsKey(a)).not.toBe(foldsKey([{ from: 0, to: 3 }]));
    expect(foldsKey([{ from: 0, to: 3 }])).not.toBe(
      foldsKey([{ from: 0, to: 4 }]),
    );
  });
});

describe('sameLines', () => {
  it('compares sets by content', () => {
    expect(sameLines(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(sameLines(new Set([1]), new Set([1, 2]))).toBe(false);
    expect(sameLines(new Set([1]), new Set([2]))).toBe(false);
  });
});
