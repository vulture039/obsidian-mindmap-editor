import { describe, it, expect } from 'vitest';
import { parseMarkdown, findByLine, MindNode } from '../parse/parser';
import {
  branchColorFor,
  branchPosition,
  DEFAULT_PALETTE,
  DEPTH_CAP,
  nodeColorFor,
  parsePalette,
} from './colors';

const RED = '#ff0000';
const GREEN = '#00ff00';
const PALETTE = [RED, GREEN, '#0000ff'];

/**
 * Two top-level branches, the first of them nested deeper than the ladder has
 * rungs, so a node can be picked by the line it is on.
 */
const TREE = parseMarkdown(
  [
    '- one', //          line 0: branch 0, list level 0
    '  - two', //        line 1: branch 0, list level 1
    '    - three', //    line 2: branch 0, list level 2
    '      - four', //   line 3: branch 0, list level 3
    '        - five', // line 4: branch 0, list level 4
    '- other', //        line 5: branch 1, list level 0
  ].join('\n'),
  'Note',
);

/** Headings count their own levels, and restart the list's under each. */
const HEADINGS = parseMarkdown(
  [
    '# one', //      line 0: heading level 1
    '## two', //     line 1: heading level 2
    '### three', //  line 2: heading level 3
    '#### four', //  line 3: heading level 4
    '- item', //     line 4: list level 0, three headings in
    '  - deeper', // line 5: list level 1
  ].join('\n'),
  'Note',
);

function nodeAt(tree: MindNode, line: number): MindNode {
  const node = findByLine(tree, line);

  if (!node) {
    throw new Error(`no node on line ${line}`);
  }

  return node;
}

const at = (line: number): MindNode => nodeAt(TREE, line);
const heading = (line: number): MindNode => nodeAt(HEADINGS, line);

describe('parsePalette', () => {
  it('reads one trimmed color per non-empty line', () => {
    expect(parsePalette('#111\n  #222  \n\n#333\n')).toEqual([
      '#111',
      '#222',
      '#333',
    ]);
  });

  it('falls back to the default palette when empty', () => {
    expect(parsePalette('')).toBe(DEFAULT_PALETTE);
    expect(parsePalette('   \n  \n')).toBe(DEFAULT_PALETTE);
  });
});

describe('branchColorFor', () => {
  it('cycles through the palette by position', () => {
    expect(branchColorFor(0, PALETTE)).toBe(RED);
    expect(branchColorFor(2, PALETTE)).toBe('#0000ff');
    expect(branchColorFor(3, PALETTE)).toBe(RED);
    expect(branchColorFor(4, PALETTE)).toBe(GREEN);
  });
});

describe('branchPosition', () => {
  it('finds the top-level branch and the depth below it', () => {
    expect(branchPosition(at(0))).toEqual({ index: 0, depth: 0 });
    expect(branchPosition(at(1))).toEqual({ index: 0, depth: 1 });
    expect(branchPosition(at(2))).toEqual({ index: 0, depth: 2 });
    expect(branchPosition(at(5))).toEqual({ index: 1, depth: 0 });
  });

  it('gives the root no position: it carries no branch color', () => {
    expect(branchPosition(TREE)).toBeNull();
  });
});

describe('nodeColorFor', () => {
  const rung = (node: MindNode): number => nodeColorFor(node, PALETTE).depth;

  it('gives the root no color and no level', () => {
    expect(nodeColorFor(TREE, PALETTE)).toEqual({ color: '', depth: 0 });
  });

  it('gives every node its own branch color, whatever its level', () => {
    expect(nodeColorFor(at(0), PALETTE).color).toBe(RED);
    expect(nodeColorFor(at(2), PALETTE).color).toBe(RED);
    expect(nodeColorFor(at(5), PALETTE).color).toBe(GREEN);
  });

  it('takes the rung from how deep the node sits', () => {
    expect(rung(at(0))).toBe(0);
    expect(rung(at(1))).toBe(1);
    expect(rung(at(2))).toBe(2);
  });

  it('counts headings the same way, so the ladder only ever goes down', () => {
    expect(rung(heading(0))).toBe(0);
    expect(rung(heading(1))).toBe(1);
    // A list under three headings carries on from them, it does not restart.
    expect(rung(heading(4))).toBe(DEPTH_CAP);
  });

  it('never draws a child above its own parent', () => {
    for (const line of [1, 2, 3, 4, 5]) {
      const node = at(line);

      expect(rung(node)).toBeGreaterThanOrEqual(rung(node.parent!));
    }
  });

  it('stops at the cap: a deeper node draws like the last rung', () => {
    expect(rung(at(3))).toBe(DEPTH_CAP);
    expect(rung(at(4))).toBe(DEPTH_CAP);
  });
});
