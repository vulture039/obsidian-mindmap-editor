import { describe, it, expect } from 'vitest';
import {
  findByLine,
  isDescendantOrSelf,
  lineMatchesNode,
  maxHeadingLevel,
  MindNode,
  parseMarkdown,
} from './parser';

/** Flatten a tree to `[type, text, line, endLine]` tuples in document order. */
function flatten(node: MindNode): [string, string, number, number][] {
  const out: [string, string, number, number][] = [];
  const walk = (n: MindNode): void => {
    if (n.type !== 'root') out.push([n.type, n.text, n.line, n.endLine]);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

describe('parseMarkdown - structure', () => {
  it('makes the note title the root and headings its children', () => {
    const root = parseMarkdown('# A\n# B', 'Note');
    expect(root.type).toBe('root');
    expect(root.text).toBe('Note');
    expect(root.children.map((c) => c.text)).toEqual(['A', 'B']);
    expect(root.children.every((c) => c.type === 'heading')).toBe(true);
  });

  it('nests headings by level', () => {
    const root = parseMarkdown('# A\n## B\n### C\n## D', 'Note');
    const a = root.children[0]!;
    expect(a.children.map((c) => c.text)).toEqual(['B', 'D']);
    expect(a.children[0]!.children.map((c) => c.text)).toEqual(['C']);
  });

  it('nests list items by indentation', () => {
    const root = parseMarkdown('- a\n  - b\n    - c\n- d', 'Note');
    expect(root.children.map((c) => c.text)).toEqual(['a', 'd']);
    const a = root.children[0]!;
    expect(a.children.map((c) => c.text)).toEqual(['b']);
    expect(a.children[0]!.children.map((c) => c.text)).toEqual(['c']);
  });

  it('parses list markers, indent, and nesting level', () => {
    const root = parseMarkdown('* a\n  1. b', 'Note');
    const a = root.children[0]!;
    expect(a.marker).toBe('*');
    expect(a.indent).toBe('');
    expect(a.level).toBe(0);
    const b = a.children[0]!;
    expect(b.marker).toBe('1.');
    expect(b.indent).toBe('  ');
    expect(b.level).toBe(1);
  });

  it('attaches list items to the enclosing heading', () => {
    const root = parseMarkdown('# H\n- a\n- b', 'Note');
    const h = root.children[0]!;
    expect(h.children.map((c) => c.text)).toEqual(['a', 'b']);
  });
});

describe('parseMarkdown - checkboxes', () => {
  it('reads unchecked and checked task state', () => {
    const root = parseMarkdown('- [ ] todo\n- [x] done\n- plain', 'Note');
    const [todo, done, plain] = root.children;
    expect(todo!.checked).toBe(false);
    expect(done!.checked).toBe(true);
    expect(plain!.checked).toBe(null);
  });

  it('treats [X] (uppercase) as checked', () => {
    const root = parseMarkdown('- [X] done', 'Note');
    expect(root.children[0]!.checked).toBe(true);
  });

  it('strips the checkbox from the node text', () => {
    const root = parseMarkdown('- [ ] buy milk', 'Note');
    expect(root.children[0]!.text).toBe('buy milk');
  });
});

describe('parseMarkdown - endLine', () => {
  it('extends a heading to just before the next same/shallower heading', () => {
    const root = parseMarkdown('# A\nbody\n## B\n# C', 'Note');
    const [a, b, c] = flatten(root);
    // 'A' runs to line 2: its section covers the body and the sub-heading
    // 'B', ending just before the next level-1 heading 'C'.
    expect(a).toEqual(['heading', 'A', 0, 2]);
    expect(b).toEqual(['heading', 'B', 2, 2]);
    // 'C' is the last heading, runs to the final line.
    expect(c).toEqual(['heading', 'C', 3, 3]);
  });

  it('rolls a list item endLine up to cover its subtree', () => {
    const root = parseMarkdown('- a\n  - b\n  - c', 'Note');
    expect(root.children[0]!.endLine).toBe(2);
  });

  it('keeps an unmarked continuation line inside the item endLine', () => {
    // The description paragraph on line 1 has no marker of its own but is
    // indented under the bullet, so it must stay within a's endLine.
    const root = parseMarkdown('- a\n  more text\n- b', 'Note');
    const a = root.children[0]!;
    expect(a.text).toBe('a');
    expect(a.endLine).toBe(1);
    expect(root.children[1]!.line).toBe(2);
  });
});

describe('parseMarkdown - skipped regions', () => {
  it('skips YAML frontmatter', () => {
    const root = parseMarkdown('---\ntitle: x\n---\n# A', 'Note');
    expect(root.children.map((c) => c.text)).toEqual(['A']);
    expect(root.children[0]!.line).toBe(3);
  });

  it('does not parse list/heading syntax inside a code fence', () => {
    const root = parseMarkdown(
      '- real\n```\n- fake\n# fake\n```\n- also',
      'Note',
    );
    expect(root.children.map((c) => c.text)).toEqual(['real', 'also']);
  });
});

describe('lineMatchesNode', () => {
  it('matches a heading only at the same level and text', () => {
    const node = parseMarkdown('## Title', 'Note').children[0]!;
    expect(lineMatchesNode('## Title', node)).toBe(true);
    expect(lineMatchesNode('### Title', node)).toBe(false);
    expect(lineMatchesNode('## Other', node)).toBe(false);
  });

  it('ignores checkbox state so a toggle still matches its line', () => {
    const node = parseMarkdown('- [ ] task', 'Note').children[0]!;
    expect(lineMatchesNode('- [ ] task', node)).toBe(true);
    expect(lineMatchesNode('- [x] task', node)).toBe(true);
  });

  it('requires the same indent for a list item', () => {
    const node = parseMarkdown('  - item', 'Note').children[0]!;
    expect(lineMatchesNode('  - item', node)).toBe(true);
    expect(lineMatchesNode('- item', node)).toBe(false);
  });
});

describe('tree helpers', () => {
  it('findByLine returns the node at a source line, else null', () => {
    const root = parseMarkdown('# A\n## B', 'Note');
    expect(findByLine(root, 1)!.text).toBe('B');
    expect(findByLine(root, 99)).toBe(null);
  });

  it('isDescendantOrSelf walks the parent chain', () => {
    const root = parseMarkdown('# A\n## B', 'Note');
    const a = root.children[0]!;
    const b = a.children[0]!;
    expect(isDescendantOrSelf(b, a)).toBe(true);
    expect(isDescendantOrSelf(a, b)).toBe(false);
    expect(isDescendantOrSelf(a, a)).toBe(true);
  });

  it('maxHeadingLevel finds the deepest heading in a subtree', () => {
    const root = parseMarkdown('# A\n## B\n### C', 'Note');
    expect(maxHeadingLevel(root.children[0]!)).toBe(3);
  });
});
