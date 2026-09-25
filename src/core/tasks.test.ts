import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './parse/parser';
import { childTasks, taskEditUpdates, taskProgress } from './tasks';

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

describe('taskEditUpdates', () => {
  it('flows an explicit parent edit down to its children', () => {
    const before = parseMarkdown(
      '- [ ] parent\n\t- [ ] first\n\t- [x] second',
      'Note',
    );
    const after = parseMarkdown(
      '- [x] parent\n\t- [ ] first\n\t- [x] second',
      'Note',
    );

    expect(
      taskEditUpdates(before, after).map(({ node, checked }) => [
        node.text,
        checked,
      ]),
    ).toEqual([['first', true]]);
  });

  it('flows an explicit child edit up to its parents', () => {
    const before = parseMarkdown(
      '- [ ] parent\n\t- [x] first\n\t- [ ] second',
      'Note',
    );
    const after = parseMarkdown(
      '- [ ] parent\n\t- [x] first\n\t- [x] second',
      'Note',
    );

    expect(
      taskEditUpdates(before, after).map(({ node, checked }) => [
        node.text,
        checked,
      ]),
    ).toEqual([['parent', true]]);
  });

  it('derives nested parents bottom-up from an edited leaf', () => {
    const before = parseMarkdown(
      '- [x] parent\n\t- [x] child\n\t\t- [x] grandchild',
      'Note',
    );
    const after = parseMarkdown(
      '- [x] parent\n\t- [x] child\n\t\t- [ ] grandchild',
      'Note',
    );

    expect(
      taskEditUpdates(before, after).map(({ node, checked }) => [
        node.text,
        checked,
      ]),
    ).toEqual([
      ['child', false],
      ['parent', false],
    ]);
  });

  it('does not normalize an inconsistent document on first observation', () => {
    const current = parseMarkdown('- [x] parent\n\t- [ ] child', 'Note');

    expect(taskEditUpdates(current, current)).toEqual([]);
  });

  it('does not overwrite explicit parent and child edits in one rewrite', () => {
    const before = parseMarkdown('- [ ] parent\n\t- [ ] child', 'Note');
    const after = parseMarkdown('- [x] parent\n\t- [x] child', 'Note');

    expect(taskEditUpdates(before, after)).toEqual([]);
  });

  it('finds a checkbox edit after lines moved', () => {
    const before = parseMarkdown(
      '- [ ] parent\n\t- [ ] first\n\t- [x] second',
      'Note',
    );
    const after = parseMarkdown(
      'intro\n- [ ] parent\n\t- [x] first\n\t- [x] second',
      'Note',
    );

    expect(
      taskEditUpdates(before, after).map(({ node, checked }) => [
        node.text,
        checked,
      ]),
    ).toEqual([['parent', true]]);
  });

  it('does not guess that a renamed task is the same checkbox', () => {
    const before = parseMarkdown(
      '- [ ] parent\n\t- [ ] first\n\t- [x] second',
      'Note',
    );
    const after = parseMarkdown(
      '- [ ] parent\n\t- [x] renamed first\n\t- [x] second',
      'Note',
    );

    expect(taskEditUpdates(before, after)).toEqual([]);
  });

  it('does not rewrite descendants after a same-line structural replacement', () => {
    const before = parseMarkdown('- [ ] old parent\n\t- [ ] old child', 'Note');
    const after = parseMarkdown('- [x] new parent\n\t- [ ] new child', 'Note');

    expect(taskEditUpdates(before, after)).toEqual([]);
  });
});
