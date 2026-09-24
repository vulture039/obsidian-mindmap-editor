import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parse/parser';
import {
  childTasks,
  hasIncompleteTask,
  taskParentUpdates,
  taskProgress,
} from './tasks';

describe('hasIncompleteTask', () => {
  it('keeps open tasks and the structural branches leading to them', () => {
    const root = parseMarkdown(
      '- group\n\t- [x] done\n\t- nested\n\t\t- [ ] open\n- plain',
      'Note',
    );
    const group = root.children[0]!;

    expect(hasIncompleteTask(root)).toBe(true);
    expect(hasIncompleteTask(group)).toBe(true);
    expect(hasIncompleteTask(group.children[0]!)).toBe(false);
    expect(hasIncompleteTask(root.children[1]!)).toBe(false);
  });
});

describe('taskProgress', () => {
  it('counts only direct child tasks', () => {
    const root = parseMarkdown(
      '- parent\n\t- [x] done\n\t\t- [ ] nested\n\t- group\n\t\t- [ ] open',
      'Note',
    );
    const parent = root.children[0]!;
    const done = parent.children[0]!;

    expect(taskProgress(root)).toBeNull();
    expect(taskProgress(parent)).toEqual({ completed: 1, total: 1 });
    expect(taskProgress(done)).toEqual({ completed: 0, total: 1 });
    expect(taskProgress(parent.children[1]!)).toEqual({
      completed: 0,
      total: 1,
    });
  });
});

describe('childTasks', () => {
  it('finds the nearest task down each structural branch', () => {
    const root = parseMarkdown(
      '- [ ] parent\n\t- group\n\t\t- [ ] nested\n\t- [x] direct',
      'Note',
    );

    expect(childTasks(root.children[0]!).map((node) => node.text)).toEqual([
      'nested',
      'direct',
    ]);
  });
});

describe('taskParentUpdates', () => {
  it('derives nested parents bottom-up', () => {
    const root = parseMarkdown(
      '- [x] parent\n\t- [x] child\n\t\t- [ ] grandchild\n\t- [x] sibling',
      'Note',
    );

    expect(
      taskParentUpdates(root).map(({ node, checked }) => [node.text, checked]),
    ).toEqual([
      ['child', false],
      ['parent', false],
    ]);
  });

  it('leaves standalone task states alone', () => {
    const root = parseMarkdown('- [x] done\n- [ ] open', 'Note');

    expect(taskParentUpdates(root)).toEqual([]);
  });
});
