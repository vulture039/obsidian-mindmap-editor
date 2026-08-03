import { describe, it, expect } from 'vitest';
import { MindNode, parseMarkdown } from '../src/core/parse/parser';
import { relocateNode } from '../src/core/write/relocate';

/**
 * The map holds off re-parsing while it is being used, so what it hands to a
 * write is the file as it was when the last render ran. These are the ways the
 * file moves underneath in the meantime - typing in the Markdown pane, mostly
 * - and a write has to find its node all the same.
 */
const OPENED = '# H\nintro\n- a\n  a text\n- b';

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

describe('a node found again in a file that moved', () => {
  const node = nodeNamed(parseMarkdown(OPENED, 'Note'), 'a');

  it('is the same node after lines are added above it', () => {
    const now = OPENED.replace('# H\n', '# H\nnew\nlines\n');

    expect(relocateNode(parseMarkdown(now, 'Note'), node)?.line).toBe(4);
  });

  it('is the same node after lines are removed above it', () => {
    const now = OPENED.replace('intro\n', '');

    expect(relocateNode(parseMarkdown(now, 'Note'), node)?.line).toBe(1);
  });

  it('refuses when two say the same thing and neither is where it was', () => {
    const now = `- a\n  a text\n${OPENED.replace('# H\n', '')}`;

    expect(relocateNode(parseMarkdown(now, 'Note'), node)).toBe(null);
  });

  it('takes the one still where it was, duplicates or not', () => {
    const now = `${OPENED}\n- a\n  a text`;

    expect(relocateNode(parseMarkdown(now, 'Note'), node)?.line).toBe(
      node.line,
    );
  });

  it('tells twins apart by what they sit under', () => {
    const opened = parseMarkdown('# H2\n- a\n  a text', 'Note');
    const now = '# H\n- a\n  a text\n# H2\n- a\n  a text';
    const found = relocateNode(
      parseMarkdown(now, 'Note'),
      nodeNamed(opened, 'a'),
    );

    expect(found?.parent?.text).toBe('H2');
  });
});
