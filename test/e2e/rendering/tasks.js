/** Task progress, checkbox synchronization, and note creation in Obsidian. */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

const wasHideCompleted = view.hideCompleted;
const wasShowingBody = view.showBodyText;

try {
  view.hideCompleted = false;
  await setFile('- [ ] Decorated task with [[Target]]');
  const decoratedTask = view.root.children[0];
  const decoratedTaskEl = view.laidByLine.get(decoratedTask.line)?.el;

  view.selectNode(decoratedTask, decoratedTaskEl);
  const decoratedHighlight = await until(() => {
    if (editor.getCursor().line !== decoratedTask.line) {
      return null;
    }
    const at = editor.cm?.domAtPos(
      editor.posToOffset({ line: decoratedTask.line, ch: 0 }),
    )?.node;
    const line =
      at?.instanceOf(Element) && at.matches('.cm-line')
        ? at
        : at?.parentElement?.closest('.cm-line');

    return line?.hasClass('mindmap-line-highlight') ? line : null;
  });

  check(
    'a decorated task falls back to whole-line source highlighting',
    !!decoratedHighlight && !CSS.highlights.has('mindmap-line'),
    decoratedHighlight?.outerHTML,
  );

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

  view.selectNode(noteNode, noteLabel.closest('.mindmap-node'));
  await settle();
  focusMap();
  await press('F2', { shiftKey: true });
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

  await setFile(['- [x] Outer', '\t- [x] Inner', '\t\t- [x] Leaf'].join('\n'));
  const leafBox = editor.getLine(2).indexOf('x');

  editor.replaceRange(
    ' ',
    { line: 2, ch: leafBox },
    {
      line: 2,
      ch: leafBox + 1,
    },
  );
  await until(async () => (await now()).startsWith('- [ ] Outer'));
  check(
    'Markdown changes synchronize nested parents bottom-up',
    (await now()).startsWith('- [ ] Outer\n\t- [ ] Inner'),
    await now(),
  );

  await setFile(['- [ ] Parent', '\t- [ ] First', '\t- [ ] Second'].join('\n'));
  const markdownParentBox = editor.getLine(0).indexOf('[ ]') + 1;

  editor.replaceRange(
    'x',
    { line: 0, ch: markdownParentBox },
    {
      line: 0,
      ch: markdownParentBox + 1,
    },
  );
  await until(async () =>
    (await now()).split('\n').every((line) => line.includes('[x]')),
  );
  check(
    'checking a parent in Markdown checks its descendants',
    (await now()).split('\n').every((line) => line.includes('[x]')),
    await now(),
  );

  await setFile(['- [ ] Parent', '\t- [ ] First', '\t- [x] Second'].join('\n'));
  editor.replaceRange('intro\n', { line: 0, ch: 0 });
  const movedChildBox = editor.getLine(2).indexOf('[ ]') + 1;

  editor.replaceRange(
    'x',
    { line: 2, ch: movedChildBox },
    { line: 2, ch: movedChildBox + 1 },
  );
  await until(async () => (await now()).split('\n')[1]?.includes('[x] Parent'));
  check(
    'Markdown checkbox sync survives lines inserted before the task',
    (await now()).split('\n')[1]?.includes('[x] Parent'),
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
  await settle();
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
  const priorityChoice = (text) =>
    [
      ...view.containerEl.doc.querySelectorAll(
        '.mindmap-task-priority-picker button',
      ),
    ].find((item) => item.textContent === text);
  const highPriority = await until(() => priorityChoice('▲ High'));
  const priorityParentMenu = priorityMenuItem.closest('.menu');
  const prioritySubmenu = highPriority.closest('.mindmap-task-priority-picker');
  const priorityItemBox = priorityMenuItem.getBoundingClientRect();
  const prioritySubmenuBox = prioritySubmenu.getBoundingClientRect();
  const prioritySubmenuSide =
    prioritySubmenuBox.right <= priorityItemBox.left ? 'left' : 'right';

  priorityMenuItem.dispatchEvent(
    new MouseEvent('mouseleave', { relatedTarget: prioritySubmenu }),
  );
  click(prioritySubmenu, 'mouseenter');
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    'moving into the priority submenu keeps it open',
    view.containerEl.doc.body.contains(highPriority),
  );
  prioritySubmenu.dispatchEvent(new MouseEvent('mouseleave'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    'leaving the priority submenu closes it',
    !view.containerEl.doc.body.contains(highPriority),
  );
  click(priorityMenuItem, 'mouseenter');
  const priorityAfterLeave = await until(() => priorityChoice('▲ High'));
  const renameItem = [
    ...priorityParentMenu.querySelectorAll('.menu-item'),
  ].find(
    (item) => item.querySelector('.menu-item-title')?.textContent === 'Rename',
  );

  click(renameItem, 'mouseenter');
  check(
    'leaving priority for another action closes its submenu',
    !view.containerEl.doc.body.contains(priorityAfterLeave),
  );
  click(priorityMenuItem, 'mouseenter');
  const reopenedHighPriority = await until(() => priorityChoice('▲ High'));
  const beforePriority = await now();

  click(reopenedHighPriority);
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
  const lowPriority = await until(() => priorityChoice('▼ Low'));
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

  click(dueMenuItem, 'mouseenter');
  let dueCalendar = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.mindmap-task-date-picker')].at(
      -1,
    ),
  );
  const dueParentMenu = dueMenuItem.closest('.menu');
  const duePriorityItem = [
    ...dueParentMenu.querySelectorAll('.menu-item'),
  ].find(
    (item) =>
      item.querySelector('.menu-item-title')?.textContent === 'Priority',
  );

  click(duePriorityItem, 'mouseenter');
  const duePriorityChoice = await until(() => priorityChoice('▲ High'));
  check(
    'priority and due-date hover controls replace each other',
    !view.containerEl.doc.body.contains(dueCalendar) && !!duePriorityChoice,
  );
  click(dueMenuItem, 'mouseenter');
  dueCalendar = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.mindmap-task-date-picker')].at(
      -1,
    ),
  );
  check(
    'returning to due date closes the priority submenu',
    !view.containerEl.doc.body.contains(duePriorityChoice),
  );
  const dueMenuBox = dueMenuItem.getBoundingClientRect();
  const dueCalendarBox = dueCalendar.getBoundingClientRect();
  const dueCalendarSide =
    dueCalendarBox.right <= dueMenuBox.left ? 'left' : 'right';
  const dueCalendarAdjacent =
    dueCalendarSide === 'left'
      ? dueMenuBox.left - dueCalendarBox.right <= 5
      : dueCalendarBox.left - dueMenuBox.right <= 5;

  check(
    'the due date menu shows its calendar beside the item',
    dueCalendarAdjacent && Math.abs(dueCalendarBox.top - dueMenuBox.top) < 2,
    JSON.stringify({
      menu: dueMenuBox.toJSON(),
      calendar: dueCalendarBox.toJSON(),
    }),
  );
  check(
    'priority and due date open on the same side',
    prioritySubmenuSide === dueCalendarSide &&
      priorityMenuItem.classList.contains('opens-left') ===
        (prioritySubmenuSide === 'left') &&
      dueMenuItem.classList.contains('opens-left') ===
        (dueCalendarSide === 'left'),
    `${prioritySubmenuSide}, ${dueCalendarSide}`,
  );
  dueMenuItem.dispatchEvent(
    new MouseEvent('mouseleave', { relatedTarget: dueCalendar }),
  );
  click(dueCalendar, 'mouseenter');
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    'moving into the calendar keeps it open',
    view.containerEl.doc.body.contains(dueCalendar),
  );
  dueCalendar.dispatchEvent(new MouseEvent('mouseleave'));
  await new Promise((resolve) => setTimeout(resolve, 200));
  check(
    'leaving the calendar closes it',
    !view.containerEl.doc.body.contains(dueCalendar),
  );
  click(dueMenuItem, 'mouseenter');
  dueCalendar = await until(() =>
    [...view.containerEl.doc.querySelectorAll('.mindmap-task-date-picker')].at(
      -1,
    ),
  );

  const beforeDueDate = await now();

  click(dueCalendar.querySelector('[data-date="2026-10-01"]'));
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

  const centeredMetadata = label('Due task')
    .closest('.mindmap-node')
    .querySelector('.mindmap-task-metadata');
  const priorityControl = centeredMetadata.querySelector(
    '.mindmap-task-priority',
  );
  const dateControl = centeredMetadata.querySelector('.mindmap-task-due-date');
  const priorityRect = priorityControl.getBoundingClientRect();
  const flagRect = priorityControl
    .querySelector('.svg-icon')
    .getBoundingClientRect();
  const dateRect = dateControl.getBoundingClientRect();
  const calendarRect = dateControl
    .querySelector('.svg-icon')
    .getBoundingClientRect();
  check(
    'inline task icons match checkbox size and align within their controls',
    Math.abs(
      flagRect.width -
        centeredMetadata
          .closest('.mindmap-node')
          .querySelector('.mindmap-checkbox')
          .getBoundingClientRect().width,
    ) < 0.5 &&
      Math.abs(calendarRect.width - flagRect.width) < 0.5 &&
      Math.abs(
        calendarRect.left - dateRect.left - flagRect.left + priorityRect.left,
      ) < 0.5 &&
      Math.abs(
        flagRect.left +
          flagRect.width / 2 -
          priorityRect.left -
          priorityRect.width / 2,
      ) < 0.5 &&
      Math.abs(
        flagRect.top +
          flagRect.height / 2 -
          priorityRect.top -
          priorityRect.height / 2,
      ) < 0.5 &&
      Math.abs(
        calendarRect.top +
          calendarRect.height / 2 -
          dateRect.top -
          dateRect.height / 2,
      ) < 0.5,
    JSON.stringify({
      priority: priorityRect.toJSON(),
      flag: flagRect.toJSON(),
      date: dateRect.toJSON(),
      calendar: calendarRect.toJSON(),
    }),
  );

  const beforeInlineDueDate = await now();
  const currentDueMetadata = label('Due task')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-task-metadata');

  click(currentDueMetadata?.querySelector('.mindmap-task-due-date'));
  const inlineCalendar = await until(() =>
    view.containerEl.doc.querySelector('.mindmap-task-date-picker'),
  );
  click(inlineCalendar.querySelector('[data-date="2026-10-02"]'));
  await written(beforeInlineDueDate);
  check(
    'clickable due date updates the task directly',
    (await now()) === '- [ ] Due task 📅 2026-10-02',
    await now(),
  );

  const changedDueTask = view.root.children[0];
  const changedDueTaskEl = view.laidByLine.get(changedDueTask.line)?.el;

  view.showNodeMenu(
    changedDueTask,
    changedDueTaskEl,
    new MouseEvent('contextmenu', { clientX: 100, clientY: 100 }),
  );
  const dueMenus = view.containerEl.doc.querySelectorAll('.menu');
  const changedDueMenu = dueMenus[dueMenus.length - 1];
  const changedDueTitles = [
    ...changedDueMenu.querySelectorAll('.menu-item-title'),
  ].map((item) => item.textContent);
  const changeDueItem = [...changedDueMenu.querySelectorAll('.menu-item')].find(
    (item) =>
      item.querySelector('.menu-item-title')?.textContent === 'Change due date',
  );

  check(
    'the due date menu delegates clearing to its calendar',
    !!changeDueItem && !changedDueTitles.includes('Clear due date'),
    changedDueTitles.join(', '),
  );
  click(changeDueItem, 'mouseenter');
  const clearDueCalendar = view.containerEl.doc.querySelector(
    '.mindmap-task-date-picker',
  );
  const beforeClearDueDate = await now();

  click(clearDueCalendar.querySelector('.mindmap-calendar-clear'));
  await written(beforeClearDueDate);
  check(
    'clearing the change-date input removes the due date',
    (await now()) === '- [ ] Due task',
    await now(),
  );

  await setFile('- [ ] Concurrent metadata task ▲');
  const staleMetadataNode = view.root.children[0];

  editor.replaceRange(' 📅 2026-12-31', {
    line: 0,
    ch: editor.getLine(0).length,
  });
  await view.setTaskMetadata(staleMetadataNode, { priority: 'low' });
  check(
    'metadata controls preserve a newer Markdown-side value',
    editor.getLine(0) === '- [ ] Concurrent metadata task ▼ 📅 2026-12-31',
    editor.getLine(0),
  );
  await drawn();
  await settle();
  for (const [side, x] of [
    ['right', 100],
    ['left', view.canvasEl.win.innerWidth - 10],
  ]) {
    const submenuNode = view.root.children[0];
    view.showNodeMenu(
      submenuNode,
      view.laidByLine.get(submenuNode.line).el,
      new MouseEvent('contextmenu', { clientX: x, clientY: 100 }),
    );
    const parent = [...view.canvasEl.doc.querySelectorAll('.menu')].at(-1);
    const rows = [...parent.querySelectorAll('.menu-item')].filter((item) =>
      ['Priority', 'Change due date', 'Rename', 'Remove checkbox'].includes(
        item.querySelector('.menu-item-title')?.textContent,
      ),
    );
    const columns = rows.map((item) => ({
      icon: item.querySelector('.menu-item-icon').getBoundingClientRect().left,
      title: item.querySelector('.menu-item-title').getBoundingClientRect()
        .left,
    }));
    check(
      `${side}-opening task menus align all icon and label columns`,
      columns.length === 4 &&
        columns.every(
          (column) =>
            Math.abs(column.icon - columns[0].icon) < 1 &&
            Math.abs(column.title - columns[0].title) < 1,
        ),
      JSON.stringify(columns),
    );
    const item = rows.find(
      (row) =>
        row.querySelector('.menu-item-title')?.textContent === 'Priority',
    );
    click(item, 'mouseenter');
    const submenu = await until(() => view.priorityMenu);
    const box = item.getBoundingClientRect();
    const submenuBox = submenu.getBoundingClientRect();
    const arrow = getComputedStyle(item, '::after');
    const left = side === 'left';
    check(
      `${side}-opening task menus place arrows beside their submenus`,
      item.classList.contains('opens-left') === left &&
        parseFloat(left ? arrow.left : arrow.right) === 8 &&
        (left ? submenuBox.right <= box.left : submenuBox.left >= box.right),
    );
    await press('Escape');
    await press('Escape');
  }
} finally {
  view.hideCompleted = wasHideCompleted;
  view.showBodyText = wasShowingBody;
  await restore();
}

return { results };
