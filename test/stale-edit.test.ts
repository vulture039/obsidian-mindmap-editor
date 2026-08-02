import { describe, it, expect } from 'vitest';
import {
  bodyRunOf,
  deleteBodyLineOp,
  moveBodyLineOp,
  setBodyOp,
} from '../src/core/write/ops';
import { MindNode, parseMarkdown } from '../src/core/parse/parser';
import { relocateBodyEdit } from '../src/core/write/relocate';

/**
 * The map holds off re-parsing while an edit is open, so what it hands to a
 * write is the file as it was when the editor opened. These are the ways the
 * file moves underneath in the meantime - typing in the Markdown pane, mostly
 * - and the edit has to land on the same text all the same.
 */
const OPENED = '# H\nintro\n- a\n  a text\n  more\n- b\n  b text';

function nodeNamed(root: MindNode, text: string): MindNode {
  const found = [root];

  while (found.length) {
    const n = found.shift()!;

    if (n.text === text) {
      return n;
    }
    found.push(...n.children);
  }
  throw new Error(`no node ${text}`);
}

/** What the view does on save, against a file that has since changed. */
function saveInto(
  now: string,
  node: MindNode,
  run: ReturnType<typeof bodyRunOf>,
  text: string,
): string {
  const lines = now.split('\n');
  const at = relocateBodyEdit(parseMarkdown(now, 'Note'), node, run);

  if (!at) {
    throw new Error('refused');
  }

  return setBodyOp(lines, at.node, text, at.anchor).join('\n');
}

describe('an edit saved against a file that moved', () => {
  const root = parseMarkdown(OPENED, 'Note');
  const node = nodeNamed(root, 'a');
  const run = bodyRunOf(node, node.body[0]!.line);

  it('lands on the same text after lines are added above it', () => {
    const now = OPENED.replace('# H\n', '# H\nnew\nlines\n');

    expect(saveInto(now, node, run, 'a text\nedited')).toBe(
      '# H\nnew\nlines\nintro\n- a\n  a text\n  edited\n- b\n  b text',
    );
  });

  it('lands on the same text after lines are removed above it', () => {
    const now = OPENED.replace('intro\n', '');

    expect(saveInto(now, node, run, 'a text\nedited')).toBe(
      '# H\n- a\n  a text\n  edited\n- b\n  b text',
    );
  });

  it('refuses when the text it was made against is gone', () => {
    const now = OPENED.replace('  a text\n  more\n', '  something else\n');

    expect(() => saveInto(now, node, run, 'whatever')).toThrow();
  });

  it('refuses when two nodes say the same thing and the lines moved', () => {
    // Both copies match; nothing left in the file says which one was open.
    const now = `- a\n  a text\n  more\n${OPENED.replace('# H\n', '')}`;

    expect(relocateBodyEdit(parseMarkdown(now, 'Note'), node, run)).toBe(null);
  });

  it('takes the one still where it was, duplicates or not', () => {
    const now = `${OPENED}\n- a\n  a text\n  more`;
    const at = relocateBodyEdit(parseMarkdown(now, 'Note'), node, run);

    expect(at?.anchor).toBe(run[0]!.line);
  });
});

describe('moving one line of a body', () => {
  const src = '- a\n  one\n  two\n  three\n- b';
  const node = nodeNamed(parseMarkdown(src, 'Note'), 'a');

  it('swaps it with the line beside it, indent and all', () => {
    expect(moveBodyLineOp(src.split('\n'), node, 2, -1)).toEqual([
      '- a',
      '  two',
      '  one',
      '  three',
      '- b',
    ]);
    expect(moveBodyLineOp(src.split('\n'), node, 2, 1)).toEqual([
      '- a',
      '  one',
      '  three',
      '  two',
      '- b',
    ]);
  });

  it('will not move a line out of its own run', () => {
    expect(() => moveBodyLineOp(src.split('\n'), node, 1, -1)).toThrow();
    expect(() => moveBodyLineOp(src.split('\n'), node, 3, 1)).toThrow();
  });

  it('leaves the file the same length', () => {
    for (const [line, delta] of [
      [1, 1],
      [2, -1],
      [2, 1],
      [3, -1],
    ] as const) {
      expect(moveBodyLineOp(src.split('\n'), node, line, delta)).toHaveLength(
        src.split('\n').length,
      );
    }
  });

  it('moves a blank line like any other', () => {
    const withGap = '- a\n  one\n\n  two\n- b';
    const gapped = nodeNamed(parseMarkdown(withGap, 'Note'), 'a');

    expect(moveBodyLineOp(withGap.split('\n'), gapped, 2, 1)).toEqual([
      '- a',
      '  one',
      '  two',
      '',
      '- b',
    ]);
  });
});

describe('deleting a line of a body that moved', () => {
  it('takes the line the map showed, wherever it is now', () => {
    const root = parseMarkdown(OPENED, 'Note');
    const node = nodeNamed(root, 'a');
    const run = bodyRunOf(node, node.body[0]!.line);
    const now = OPENED.replace('# H\n', '# H\nnew\n');
    const at = relocateBodyEdit(parseMarkdown(now, 'Note'), node, run)!;

    expect(deleteBodyLineOp(now.split('\n'), at.node, at.anchor + 1)).toEqual([
      '# H',
      'new',
      'intro',
      '- a',
      '  a text',
      '- b',
      '  b text',
    ]);
  });
});
