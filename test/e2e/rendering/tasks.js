/** Task progress, checkbox synchronization, and note creation in Obsidian. */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

const wasHideCompleted = view.hideCompleted;
const wasShowingBody = view.showBodyText;
const wasFocusingTasks = view.focusIncompleteTasks;

try {
  view.hideCompleted = false;
  await setFile(
    ['- Parent', '\t- [x] Done', '\t- [ ] Open', '- [ ] Note task'].join('\n'),
  );

  const parent = label('Parent')?.closest('.mindmap-node');
  const progress = parent?.querySelector('.mindmap-task-progress');

  check(
    'a plain parent shows direct child task progress',
    progress?.getAttribute('aria-valuenow') === '1' &&
      progress?.getAttribute('aria-valuemax') === '2' &&
      progress.textContent === '1/2',
    progress?.outerHTML,
  );

  view.focusIncompleteTasks = true;
  await view.render();
  check(
    'task focus keeps open work and hides completed-only branches',
    label('Parent') && label('Open') && label('Note task') && !label('Done'),
  );
  view.focusIncompleteTasks = false;
  await view.render();

  await setFile(
    ['- [ ] Parent', '\t- [x] Done', '\t- [ ] Open', '- [ ] Note task'].join(
      '\n',
    ),
  );

  const openBox = label('Open')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-checkbox');
  const beforeChild = await now();

  click(openBox);
  await written(beforeChild);
  await drawn();
  check(
    'checking the last open child checks its parent',
    (await now())
      .split('\n')
      .slice(0, 3)
      .every((line) => line.includes('[x]')),
    await now(),
  );

  const refreshedParent = label('Parent')?.closest('.mindmap-node');
  const parentBox = refreshedParent?.querySelector('.mindmap-checkbox');
  const beforeParent = await now();

  click(parentBox);
  await written(beforeParent);
  await drawn();
  check(
    'unchecking a parent unchecks its descendants',
    (await now())
      .split('\n')
      .slice(0, 3)
      .every((line) => line.includes('[ ]')),
    await now(),
  );

  const noteLabel = await until(() => label('Note task'));
  const noteNode = view.laidByLine.get(
    Number(noteLabel?.closest('.mindmap-node')?.dataset.line),
  )?.node;

  await view.addTaskNote(noteNode);
  await until(async () => (await now()).includes('- [ ] Note task\n\t'));
  check(
    'creating a task note writes an indented Markdown line and opens text',
    (await now()).includes('- [ ] Note task\n\t') && view.showBodyText,
    await now(),
  );

  await setFile(['- [x] Outer', '\t- [x] Inner', '\t\t- [ ] Leaf'].join('\n'));
  await until(async () => (await now()).startsWith('- [ ] Outer'));
  check(
    'Markdown changes synchronize nested parents bottom-up',
    (await now()).startsWith('- [ ] Outer\n\t- [ ] Inner'),
    await now(),
  );
} finally {
  view.hideCompleted = wasHideCompleted;
  view.showBodyText = wasShowingBody;
  view.focusIncompleteTasks = wasFocusingTasks;
  await restore();
}

return { results };
