import { describe, it, expect } from 'vitest';
import { multiLineValue } from '../src/core/write/edit-value';
import { bodyRunOf, deleteBodyLineOp, setBodyOp } from '../src/core/write/ops';
import { MindNode, parseMarkdown } from '../src/core/parse/parser';

/**
 * What the view does between opening a body editor and saving it: the run's
 * text goes in, comes back through the editor's normalizing, and is written.
 * Editing nothing must therefore leave the file exactly as it was - anything
 * else is the map quietly rewriting text nobody touched.
 */
function reopenAndSave(src: string, node: MindNode, anchor: number): string {
  const run = bodyRunOf(node, anchor);
  const shown = run.map((b) => b.text).join('\n');
  const typed = multiLineValue(shown);

  // The view writes only when the value differs from what it opened with -
  // a run of blank lines comes back as nothing, and that is not an emptying.
  if (typed === multiLineValue(shown)) {
    return src;
  }

  return setBodyOp(src.split('\n'), node, typed, anchor).join('\n');
}

/** Every node with text of its own, and the anchor of each of its runs. */
function bodyRuns(root: MindNode): { node: MindNode; anchor: number }[] {
  const out: { node: MindNode; anchor: number }[] = [];
  const visit = (n: MindNode): void => {
    const anchors = new Set(n.body.map((b) => bodyRunOf(n, b.line)[0]!.line));

    for (const anchor of anchors) {
      out.push({ node: n, anchor });
    }
    n.children.forEach(visit);
  };

  visit(root);

  return out;
}

const DOCS: Record<string, string> = {
  'description under an item': '- a\n  one\n  two\n- b',
  'paragraph break inside a body': '- a\n  one\n\n  two\n- b',
  'blank line that carries indent': '- a\n  one\n  \n  two\n- b',
  'block nested inside a body': '- a\n  one\n\n      code\n\n  two\n- b',
  'heading text in two runs': '# H\nintro\n\n- a\n\ntail\n',
  'body at the end of the file': '# H\n- a\n  tail',
  'body followed by blank lines': '# H\nintro\n\n\n# I\n',
  'text with trailing spaces': '- a\n  one  \n  two\n- b',
  'deeply indented description': '- a\n  - b\n    one\n    two\n- c',
  'text under a task': '- [ ] a\n  one\n- [x] b',
  'run that begins with a blank': '# H\n\n- a\n\ntail\n',
  'body of the last node in the file': '# H\n- a\n  one\n\n',
  'text between two children': '# H\nbefore\n- a\nafter\n- b',
  'tab indent': '- a\n\tone\n\ttwo\n- b',
  'text under a heading and its list': '# H\nintro\n- a\n  detail\n## I\n',
  'run of nothing but blank lines': '# H\nintro\n- a\n\n\n- b\ntail',
};

describe('a body edit that changes nothing', () => {
  for (const [name, src] of Object.entries(DOCS)) {
    it(`leaves the file alone: ${name}`, () => {
      const root = parseMarkdown(src, 'Note');

      for (const { node, anchor } of bodyRuns(root)) {
        expect(reopenAndSave(src, node, anchor), `${name} @${anchor}`).toBe(
          src,
        );
      }
    });
  }
});

describe('deleting one line of a body', () => {
  it('takes that line and nothing else', () => {
    for (const src of Object.values(DOCS)) {
      const root = parseMarkdown(src, 'Note');

      for (const { node, anchor } of bodyRuns(root)) {
        const run = bodyRunOf(node, anchor);

        for (const gone of run) {
          const after = deleteBodyLineOp(src.split('\n'), node, gone.line);
          const before = src.split('\n');

          expect(after.length, `${src} minus ${gone.line}`).toBe(
            before.length - 1,
          );
          expect(after.slice(0, run[0]!.line)).toEqual(
            before.slice(0, run[0]!.line),
          );
        }
      }
    }
  });
});

describe('a body edit that adds a line', () => {
  it('touches nothing but the run it was made in', () => {
    for (const src of Object.values(DOCS)) {
      const root = parseMarkdown(src, 'Note');

      for (const { node, anchor } of bodyRuns(root)) {
        const run = bodyRunOf(node, anchor);
        const typed = `${multiLineValue(run.map((b) => b.text).join('\n'))}\nadded`;
        const after = setBodyOp(src.split('\n'), node, typed, anchor);
        const before = src.split('\n');
        const end = run[run.length - 1]!.line;

        // Everything above the run and everything below it is untouched, and
        // what was typed is inside it. The run itself grows by a line, unless
        // the typing went into blank lines it already had.
        const shift = after.length - before.length;

        expect(shift).toBeGreaterThanOrEqual(0);
        expect(after.slice(0, run[0]!.line)).toEqual(
          before.slice(0, run[0]!.line),
        );
        expect(after.slice(end + 1 + shift)).toEqual(before.slice(end + 1));
        expect(
          after
            .slice(run[0]!.line, end + 1 + shift)
            .some((l) => l.includes('added')),
        ).toBe(true);
      }
    }
  });
});
