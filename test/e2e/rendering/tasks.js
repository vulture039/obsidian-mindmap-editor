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
  const sourceView = md.view.containerEl.querySelector('.markdown-source-view');
  const staleHighlight = sourceView.createSpan({
    cls: 'mindmap-line-highlight',
    text: 'stale',
  });

  await view.addTaskNote(noteNode);
  const withNote = await until(async () => {
    const text = await now();

    return /- \[ \] Note task\n\t(?:\n|$)/.test(text) ? text : null;
  });
  const noteLine = (withNote ?? '')
    .split('\n')
    .findIndex(
      (line, index, lines) =>
        index > 0 &&
        lines[index - 1]?.includes('[ ] Note task') &&
        /^\s*$/.test(line),
    );
  const noteField = await until(() => {
    const line = drawnAt(noteLine);

    return line?.querySelector('.mindmap-mirrored-caret') ? line : null;
  });
  const activeEditorLine = await until(() =>
    drawnAt(noteLine)?.querySelector('.mindmap-mirrored-caret'),
  );
  check(
    'creating a task note writes its line and opens a field on the map',
    !!noteField &&
      view.showBodyText &&
      editor.hasFocus() &&
      editor.getCursor().ch === 1 &&
      !!activeEditorLine &&
      staleHighlight.isConnected &&
      !staleHighlight.hasClass('mindmap-line-highlight') &&
      !md.view.containerEl.querySelector('.mindmap-line-highlight') &&
      !CSS.highlights.has('mindmap-line'),
    noteField?.outerHTML ?? (await now()),
  );

  editor.replaceRange('first line', editor.getCursor());
  check(
    'the note cursor stays visible while typing',
    !!drawnAt(noteLine)?.querySelector('.mindmap-mirrored-caret'),
  );
  await until(() => drawnAt(noteLine)?.textContent.includes('first line'));
  editor.setCursor({ line: noteLine, ch: editor.getLine(noteLine).length });
  const nodesBeforeEnter = el.querySelectorAll('.mindmap-node').length;
  const linesBeforeEnter = editor.lineCount();

  await press('Enter');
  const nextLine = await until(() =>
    editor.lineCount() === linesBeforeEnter + 1 ? drawnAt(noteLine + 1) : null,
  );
  check(
    'Enter in a mirrored task note adds a note line, not a node',
    !!nextLine &&
      editor.getCursor().line === noteLine + 1 &&
      editor.getLine(noteLine + 1) ===
        /^\s*/.exec(editor.getLine(noteLine))?.[0] &&
      !!nextLine?.querySelector('.mindmap-mirrored-caret') &&
      el.querySelectorAll('.mindmap-node').length === nodesBeforeEnter,
    await now(),
  );

  await setFile(['- [x] Outer', '\t- [x] Inner', '\t\t- [ ] Leaf'].join('\n'));
  await until(async () => (await now()).startsWith('- [ ] Outer'));
  check(
    'Markdown changes synchronize nested parents bottom-up',
    (await now()).startsWith('- [ ] Outer\n\t- [ ] Inner'),
    await now(),
  );

  await setFile('# Heading\n- Plain list');
  const heading = view.root.children.find((node) => node.text === 'Heading');
  const plain = heading?.children.find((node) => node.text === 'Plain list');

  await view.addTaskNote(plain);
  const plainLine = (plain?.line ?? -1) + 1;
  const plainNote = await until(() => {
    const line = drawnAt(plainLine);

    return line?.querySelector('.mindmap-mirrored-caret') ? line : null;
  });
  check(
    'a plain list node can add and display a note',
    !!plainNote &&
      editor.getLine(plainLine) === '\t' &&
      editor.getCursor().ch === 1 &&
      !!plainNote.querySelector('.mindmap-mirrored-caret'),
    await now(),
  );

  await setFile('# Heading');
  const freshHeading = view.root.children.find(
    (node) => node.text === 'Heading',
  );

  await view.addTaskNote(freshHeading);
  const headingLine = (freshHeading?.line ?? -1) + 1;
  const headingNote = await until(() => drawnAt(headingLine));
  check(
    'a heading node can add and display a note',
    !!headingNote && editor.getLine(headingLine) === '',
    await now(),
  );

  await setFile('- [ ] Priority task');
  const priorityTask = view.root.children[0];
  const priorityTaskEl = view.laidByLine.get(priorityTask.line)?.el;

  view.showNodeMenu(
    priorityTask,
    priorityTaskEl,
    new MouseEvent('contextmenu', { clientX: 100, clientY: 100 }),
  );
  const priorityMenuItem = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.menu-item')].find(
      (item) =>
        item.querySelector('.menu-item-title')?.textContent === 'Priority',
    ),
  );

  click(priorityMenuItem, 'mouseenter');
  const highPriority = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.menu-item')].find(
      (item) =>
        item.querySelector('.menu-item-title')?.textContent === '▲ High',
    ),
  );
  const beforePriority = await now();

  click(highPriority);
  await written(beforePriority);
  await drawn();
  const priorityMetadata = label('Priority task')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-task-metadata');

  check(
    'priority picker writes and displays a task priority',
    (await now()) === '- [ ] Priority task ▲' &&
      priorityMetadata?.textContent === '▲',
    `${await now()}\n${priorityMetadata?.outerHTML ?? ''}`,
  );

  click(priorityMetadata?.querySelector('.mindmap-task-priority'));
  const lowPriority = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.menu-item')].find(
      (item) => item.querySelector('.menu-item-title')?.textContent === '▼ Low',
    ),
  );
  const beforeDirectPriority = await now();

  click(lowPriority);
  await written(beforeDirectPriority);
  check(
    'clickable priority updates the task directly',
    (await now()) === '- [ ] Priority task ▼',
    await now(),
  );

  await setFile('- [ ] Due task');
  const dueTask = view.root.children[0];
  const dueTaskEl = view.laidByLine.get(dueTask.line)?.el;

  view.showNodeMenu(
    dueTask,
    dueTaskEl,
    new MouseEvent('contextmenu', { clientX: 100, clientY: 100 }),
  );
  const dueMenuItem = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.menu-item')].find(
      (item) =>
        item.querySelector('.menu-item-title')?.textContent === 'Set due date',
    ),
  );

  click(dueMenuItem);
  const dueInput = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.mindmap-task-date-picker')].at(
      -1,
    ),
  );

  type(dueInput, '2026-10-01');
  const beforeDueDate = await now();

  dueInput.dispatchEvent(new Event('change', { bubbles: true }));
  await written(beforeDueDate);
  await drawn();
  const dueMetadata = label('Due task')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-task-metadata');
  const dueFile = await now();
  const dueDateShown =
    dueMetadata?.querySelector('.mindmap-task-due-date')?.textContent ===
    '2026-10-01';
  const dueIconShown = !!dueMetadata?.querySelector('.lucide-calendar-days');
  const dueBadge = dueMetadata?.querySelector('.mindmap-task-due-date');
  const priorityBadge = dueMetadata?.querySelector('.mindmap-task-priority');
  const dueStyle = dueBadge && getComputedStyle(dueBadge);
  const priorityStyle = priorityBadge && getComputedStyle(priorityBadge);

  check(
    'calendar date picker writes and displays a due date',
    dueFile === '- [ ] Due task 📅 2026-10-01' && dueDateShown && dueIconShown,
    `${JSON.stringify({ dueFile, dueDateShown, dueIconShown })}\n${
      dueMetadata?.outerHTML ?? ''
    }`,
  );
  check(
    'task metadata controls stay compact and equally high',
    dueStyle?.height === '22px' &&
      priorityStyle?.height === '22px' &&
      dueStyle.width === '108px' &&
      dueStyle.backgroundColor === priorityStyle.backgroundColor &&
      dueStyle.boxShadow === priorityStyle.boxShadow,
    JSON.stringify({
      due: dueStyle && { width: dueStyle.width, height: dueStyle.height },
      priority: priorityStyle && {
        width: priorityStyle.width,
        height: priorityStyle.height,
      },
      backgrounds: {
        due: dueStyle?.backgroundColor,
        priority: priorityStyle?.backgroundColor,
      },
    }),
  );

  const inlineDueInput = dueMetadata?.querySelector(
    '.mindmap-task-date-trigger',
  );

  type(inlineDueInput, '2026-10-02');
  const beforeInlineDueDate = await now();

  inlineDueInput.dispatchEvent(new Event('change', { bubbles: true }));
  await written(beforeInlineDueDate);
  check(
    'clickable due date updates the task directly',
    (await now()) === '- [ ] Due task 📅 2026-10-02',
    await now(),
  );
} finally {
  view.hideCompleted = wasHideCompleted;
  view.showBodyText = wasShowingBody;
  view.focusIncompleteTasks = wasFocusingTasks;
  await restore();
}

return { results };
