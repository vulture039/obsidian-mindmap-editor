import { describe, it, expect } from 'vitest';
import { parseMarkdown } from './parser';
import { isCollapsible, pruneCollapsed } from './folds';

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
});

describe('pruneCollapsed', () => {
  it('drops lines that no longer start a branch', () => {
    const root = parseMarkdown(NOTE, 'Note');

    expect([...pruneCollapsed(root, new Set([0, 2, 42]))]).toEqual([0]);
  });
});
