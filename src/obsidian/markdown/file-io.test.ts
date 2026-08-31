import { describe, it, expect } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { joinLike, leafNearness, sameSplit } from './file-io';

function leaf(container: object): WorkspaceLeaf {
  return { getContainer: () => container } as WorkspaceLeaf;
}

describe('leafNearness', () => {
  it('ranks the requested leaf above its window and other windows', () => {
    const here = {};
    const there = {};
    const near = leaf(here);

    expect(leafNearness(near, near)).toBe(2);
    expect(leafNearness(leaf(here), near)).toBe(1);
    expect(leafNearness(leaf(there), near)).toBe(0);
    expect(leafNearness(near)).toBe(0);
  });
});

describe('sameSplit', () => {
  it('distinguishes side-by-side panes from tabs in the same pane', () => {
    const split = {};
    const left = { parent: split };
    const right = { parent: split };
    const leftTab = { parent: left } as WorkspaceLeaf;

    expect(sameSplit(leftTab, { parent: left } as WorkspaceLeaf)).toBe(false);
    expect(sameSplit(leftTab, { parent: right } as WorkspaceLeaf)).toBe(true);
  });
});

describe('joinLike', () => {
  it('keeps the endings a note came with', () => {
    expect(joinLike(['a', 'b'], 'x\r\ny')).toBe('a\r\nb');
    expect(joinLike(['a', 'b'], 'x\ny')).toBe('a\nb');
  });

  it('takes a note with no ending at all for a plain one', () => {
    expect(joinLike(['only'], 'only')).toBe('only');
  });
});
