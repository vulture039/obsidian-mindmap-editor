import { describe, it, expect } from 'vitest';
import { parseMarkdown, findByLine, MindNode } from '../parse/parser';
import {
  BRANCH_FAMILY_COUNT,
  branchPosition,
  DEPTH_CAP,
  NodeColor,
  nodeColorFor,
  parsePalette,
  rungBelow,
} from './colors';

/**
 * Two top-level branches, the first of them nested deeper than the ladder has
 * rungs, so a node can be picked by the line it is on.
 */
const TREE = parseMarkdown(
  [
    '- one', //               line 0: branch 0, list level 0
    '  - two', //             line 1: branch 0, list level 1
    '    - three', //         line 2: branch 0, list level 2
    '      - four', //        line 3: branch 0, list level 3
    '        - five', //      line 4: branch 0, list level 4
    '          - six', //     line 5: branch 0, list level 5
    '            - seven', // line 6: branch 0, list level 6
    '- other', //             line 7: branch 1, list level 0
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

const SIBLINGS = parseMarkdown(
  [
    '- branch',
    '  - first',
    '    - first child A',
    '    - first child B',
    '  - second',
    '    - second child',
    '  - third',
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

/** One list item per level, deep enough for the tail to come round twice. */
const DEEP = parseMarkdown(
  Array.from(
    { length: DEPTH_CAP + 4 },
    (_, i) => `${'  '.repeat(i)}- ${i}`,
  ).join('\n'),
  'Note',
);

const at = (line: number): MindNode => nodeAt(TREE, line);
const heading = (line: number): MindNode => nodeAt(HEADINGS, line);
const deep = (line: number): MindNode => nodeAt(DEEP, line);

describe('parsePalette', () => {
  it('reads one trimmed color per non-empty line', () => {
    expect(parsePalette('#111\n  #222  \n\n#333\n')).toEqual([
      '#111',
      '#222',
      '#333',
    ]);
  });
});

describe('branchPosition', () => {
  it('finds the top-level branch and the depth below it', () => {
    expect(branchPosition(at(0))).toEqual({ index: 0, depth: 0 });
    expect(branchPosition(at(1))).toEqual({ index: 0, depth: 1 });
    expect(branchPosition(at(2))).toEqual({ index: 0, depth: 2 });
    expect(branchPosition(at(7))).toEqual({ index: 1, depth: 0 });
  });

  it('gives the root no position: it carries no branch color', () => {
    expect(branchPosition(TREE)).toBeNull();
  });
});

describe('nodeColorFor', () => {
  const rung = (node: MindNode): number => nodeColorFor(node).depth;

  it('gives the root no color and no level', () => {
    expect(nodeColorFor(TREE)).toEqual({
      color: '',
      depth: 0,
    });
  });

  it('takes a fixed top-level family and varies its descendants', () => {
    expect(nodeColorFor(at(0)).color).toBe('oklch(62% 0.131 244)');
    expect(nodeColorFor(at(2)).color).not.toBe(nodeColorFor(at(0)).color);
    expect(nodeColorFor(at(7)).color).not.toBe(nodeColorFor(at(0)).color);
  });

  it('uses configured colors as the family bases', () => {
    const palette = ['#ff0000', '#00ff00'];

    expect(nodeColorFor(at(0), palette).color).toBe('#ff0000');
    expect(nodeColorFor(at(7), palette).color).toBe('#00ff00');
    expect(nodeColorFor(at(1), palette).color).toContain('from #ff0000');
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
    expect(rung(heading(4))).toBe(4);
    expect(rung(heading(5))).toBe(DEPTH_CAP);
  });

  it('never draws a child above its own parent', () => {
    for (const line of [1, 2, 3, 4, 5, 6]) {
      const node = at(line);

      expect(rung(node)).toBeGreaterThanOrEqual(rung(node.parent!));
    }
  });

  it('alternates past the cap, so nothing draws as its own parent', () => {
    expect(rung(deep(DEPTH_CAP))).toBe(DEPTH_CAP);
    expect(rung(deep(DEPTH_CAP + 1))).toBe(DEPTH_CAP + 1);
    expect(rung(deep(DEPTH_CAP + 2))).toBe(DEPTH_CAP);
    expect(rung(deep(DEPTH_CAP + 3))).toBe(DEPTH_CAP + 1);
  });

  it('gives neighbours clean colors from the parent hue family', () => {
    const style = (line: number): NodeColor =>
      nodeColorFor(nodeAt(SIBLINGS, line));

    expect(style(0).color).toBe('oklch(62% 0.131 244)');
    expect(style(4).color).not.toBe(style(1).color);
    expect(style(6).color).not.toBe(style(4).color);
    expect(style(2).color).not.toBe(style(3).color);
  });

  it('separates parent and sibling hues within one family', () => {
    const tree = parseMarkdown(
      ['- parent', '  - one', '  - two', '  - three'].join('\n'),
      'Note',
    );
    const parent = nodeColorFor(nodeAt(tree, 0));
    const children = tree.children[0]!.children.map((node) =>
      nodeColorFor(node),
    );

    expect(children.every((child) => child.color !== parent.color)).toBe(true);
    expect(
      children.every(
        (child, index) =>
          index === 0 || child.color !== children[index - 1]!.color,
      ),
    ).toBe(true);
    expect(
      new Set([parent.color, ...children.map((child) => child.color)]).size,
    ).toBe(4);
  });

  it('never leaves the top-level branch color family', () => {
    const tree = parseMarkdown(
      [
        '- branch',
        '  - one',
        '    - one A',
        '      - one A i',
        '        - one A i alpha',
        '  - two',
        '    - two A',
        '    - two B',
      ].join('\n'),
      'Note',
    );
    const colors = tree.children
      .flatMap(function descendants(node): MindNode[] {
        return [node, ...node.children.flatMap(descendants)];
      })
      .map((node) => nodeColorFor(node).color);

    expect(new Set(colors).size).toBeLessThanOrEqual(6);
  });

  it('uses every family color before looping among many siblings', () => {
    const tree = parseMarkdown(
      ['- branch', ...Array.from({ length: 8 }, (_, i) => `  - ${i}`)].join(
        '\n',
      ),
      'Note',
    );
    const colors = tree.children[0]!.children.map(
      (node) => nodeColorFor(node).color,
    );

    expect(new Set(colors.slice(0, 5)).size).toBe(5);
    expect(colors[5]).toBe(colors[0]);
    expect(colors[6]).toBe(colors[1]);
  });

  it('keeps yellow bright enough not to become ochre', () => {
    const tree = parseMarkdown(
      Array.from({ length: BRANCH_FAMILY_COUNT }, (_, i) => `- ${i}`).join(
        '\n',
      ),
      'Note',
    );

    expect(nodeColorFor(tree.children[4]!).color).toBe('oklch(78% 0.172 105)');
  });

  it('loops top-level families after five branches', () => {
    const tree = parseMarkdown(
      Array.from({ length: BRANCH_FAMILY_COUNT + 1 }, (_, i) => `- ${i}`).join(
        '\n',
      ),
      'Note',
    );
    const firstRun = tree.children
      .slice(0, BRANCH_FAMILY_COUNT)
      .map((node) => nodeColorFor(node).color);

    expect(new Set(firstRun).size).toBe(BRANCH_FAMILY_COUNT);
    expect(nodeColorFor(tree.children[BRANCH_FAMILY_COUNT]!).color).toBe(
      firstRun[0],
    );
  });

  it('keeps depth rungs with neighboring branch colors', () => {
    expect(nodeColorFor(nodeAt(SIBLINGS, 5)).depth).toBe(2);
  });
});

describe('rungBelow', () => {
  it('steps down the ladder, then takes the tail in turn', () => {
    expect(rungBelow(0)).toBe(1);
    expect(rungBelow(DEPTH_CAP - 1)).toBe(DEPTH_CAP);
    expect(rungBelow(DEPTH_CAP)).toBe(DEPTH_CAP + 1);
    expect(rungBelow(DEPTH_CAP + 1)).toBe(DEPTH_CAP);
  });
});
