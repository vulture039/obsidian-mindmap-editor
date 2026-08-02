import { describe, it, expect } from 'vitest';
import { LaidNode, layoutTree, makeLaid } from './layout';
import { MindNode } from '../parse/parser';

/**
 * The layout reads offsetWidth/offsetHeight off real elements, which is all it
 * needs from them - so a plain object with those two answers is enough to run
 * the whole thing without a DOM.
 */
function laid(w: number, h: number, children: LaidNode[] = []): LaidNode {
  const node = makeLaid(
    {} as MindNode,
    { offsetWidth: w, offsetHeight: h } as HTMLElement,
    '',
  );

  node.children = children;

  return node;
}

/** Every node of the laid-out tree, parents before children. */
function all(root: LaidNode, out: LaidNode[] = []): LaidNode[] {
  out.push(root);
  root.children.forEach((c) => all(c, out));

  return out;
}

describe('layoutTree', () => {
  it('puts children to the right of their parent, in one column', () => {
    const a = laid(40, 20);
    const b = laid(40, 20);
    const root = laid(60, 20, [a, b]);

    layoutTree(root);

    expect(a.x).toBe(b.x);
    expect(a.x).toBeGreaterThan(root.x + root.w);
  });

  it('keeps siblings apart, whatever their heights', () => {
    const kids = [laid(40, 20), laid(40, 80), laid(40, 20)];
    const root = laid(60, 20, kids);

    layoutTree(root);

    for (let i = 1; i < kids.length; i++) {
      const above = kids[i - 1]!;

      expect(kids[i]!.y).toBeGreaterThanOrEqual(above.y + above.h);
    }
  });

  it('centres a parent on the block its children take up', () => {
    const kids = [laid(40, 20), laid(40, 20)];
    const root = laid(60, 20, kids);

    layoutTree(root);
    const top = kids[0]!;
    const bottom = kids[kids.length - 1]!;
    const middle = (top.y + bottom.y + bottom.h) / 2;

    expect(root.y + root.h / 2).toBeCloseTo(middle);
  });

  it('gives a tall node the room it needs, not its subtree', () => {
    // A node with body text can be taller than everything under it.
    const child = laid(40, 20);
    const tall = laid(60, 200, [child]);
    const short = laid(60, 20);
    const root = laid(60, 20, [tall, short]);

    layoutTree(root);

    expect(short.y).toBeGreaterThanOrEqual(tall.y + tall.h);
  });

  it('never overlaps two nodes', () => {
    const root = laid(60, 20, [
      laid(40, 60, [laid(30, 20), laid(30, 20)]),
      laid(40, 20, [laid(30, 90)]),
      laid(40, 20),
    ]);

    layoutTree(root);
    const nodes = all(root);

    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) {
          continue;
        }
        const apart =
          a.x + a.w <= b.x ||
          b.x + b.w <= a.x ||
          a.y + a.h <= b.y ||
          b.y + b.h <= a.y;

        expect(apart, `${a.x},${a.y} overlaps ${b.x},${b.y}`).toBe(true);
      }
    }
  });

  it('reports a canvas that holds every node', () => {
    const root = laid(60, 20, [laid(40, 60), laid(40, 200, [laid(80, 20)])]);
    const { width, height } = layoutTree(root);

    for (const node of all(root)) {
      expect(node.x + node.w).toBeLessThanOrEqual(width);
      expect(node.y + node.h).toBeLessThanOrEqual(height);
    }
  });

  it('lays out the same tree the same way twice', () => {
    const build = (): LaidNode =>
      laid(60, 20, [laid(40, 20, [laid(30, 20)]), laid(40, 60)]);
    const first = build();
    const second = build();

    layoutTree(first);
    layoutTree(second);

    expect(all(first).map((n) => [n.x, n.y])).toEqual(
      all(second).map((n) => [n.x, n.y]),
    );
  });
});
