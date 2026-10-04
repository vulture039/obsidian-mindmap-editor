/** A hovered node exposes compact common actions without prior selection. */
await setFile('- First\n- Second');
const first = label('First')?.closest('.mindmap-node');
const second = label('Second')?.closest('.mindmap-node');
const before = first?.getBoundingClientRect();

const actions = first?.querySelector('.mindmap-node-actions');
const hiddenBeforeHover = getComputedStyle(actions).display === 'none';
first?.dispatchEvent(new PointerEvent('pointerenter'));
await until(() => getComputedStyle(actions).display === 'flex');
const labels = [...(actions?.querySelectorAll('button') ?? [])].map((button) =>
  button.getAttribute('aria-label'),
);
const controlStyle = (control) => {
  const style = getComputedStyle(control);

  return {
    width: style.width,
    height: style.height,
    padding: style.padding,
    border: style.border,
    radius: style.borderRadius,
    background: style.backgroundColor,
    color: style.color,
    shadow: style.boxShadow,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
  };
};
const commonControlStyles = [...actions.children].map(controlStyle);
const after = first?.getBoundingClientRect();
const actionBox = actions?.getBoundingClientRect();

check(
  'a hovered node shows common actions without prior selection',
  !!actions &&
    hiddenBeforeHover &&
    getComputedStyle(actions).display === 'flex' &&
    !!actions.querySelector('.lucide-plus') &&
    !!actions.querySelector('.lucide-corner-down-right') &&
    labels.join(',') === 'Add child,Add sibling,Add checkbox,More actions',
  labels.join(', '),
);
check(
  'the action bar does not change the node size',
  !!before &&
    !!after &&
    !!actionBox &&
    before.width === after.width &&
    before.height === after.height &&
    after.top - actionBox.bottom > 0 &&
    after.top - actionBox.bottom <= 5 &&
    actionBox.width <= 105,
  `node ${JSON.stringify(after?.toJSON())}; actions ${JSON.stringify(actionBox?.toJSON())}`,
);

first.scrollIntoView({ block: 'center', inline: 'center' });
const hoverNodeBox = first.getBoundingClientRect();
const hoverActionsBox = actions.getBoundingClientRect();
const hoverGapY = (hoverNodeBox.top + hoverActionsBox.bottom) / 2;
check(
  'the node-to-toolbar gap remains a hover target across both widths',
  [
    hoverNodeBox.left + hoverNodeBox.width / 2,
    hoverNodeBox.left + hoverNodeBox.width / 4,
    hoverActionsBox.left + hoverActionsBox.width / 4,
  ].every(
    (x) =>
      view.canvasEl.doc
        .elementFromPoint(x, hoverGapY)
        ?.closest('.mindmap-node') === first,
  ),
);

first?.dispatchEvent(
  new PointerEvent('pointerleave', { relatedTarget: actions }),
);
check(
  'the action bar stays open while moving into it',
  getComputedStyle(actions).display === 'flex',
);
first?.dispatchEvent(new PointerEvent('pointerleave'));
check(
  'the action bar hides after leaving the node and bar',
  getComputedStyle(actions).display === 'none',
);

first?.dispatchEvent(new PointerEvent('pointerenter'));
click(first?.querySelector('[aria-label="More actions"]'));
const deleteItem = await until(() =>
  [...view.containerEl.doc.querySelectorAll('.menu-item')].find(
    (item) => item.querySelector('.menu-item-title')?.textContent === 'Delete',
  ),
);
check('more actions opens the full node menu', !!deleteItem);
key('Escape');
await until(() => !view.containerEl.doc.querySelector('.menu'));

first?.dispatchEvent(new PointerEvent('pointerleave'));
second?.dispatchEvent(new PointerEvent('pointerenter'));
check(
  'only the hovered node shows its action bar',
  getComputedStyle(actions).display === 'none' &&
    getComputedStyle(second?.querySelector('.mindmap-node-actions')).display ===
      'flex',
);
second?.dispatchEvent(new PointerEvent('pointerleave'));

await setFile('- Parent');
const parent = label('Parent')?.closest('.mindmap-node');

parent?.dispatchEvent(new PointerEvent('pointerenter'));
click(parent?.querySelector('[aria-label="Add child"]'));
check('an action bar button runs its node action', !!(await until(editing)));
await closeEditor();

await setFile('- Toggle');
const toggle = label('Toggle')?.closest('.mindmap-node');

toggle?.dispatchEvent(new PointerEvent('pointerenter'));
const beforeToggle = await now();

click(toggle?.querySelector('[aria-label="Add checkbox"]'));
await written(beforeToggle);
check(
  'the action bar converts a list item into a task',
  (await now()) === '- [ ] Toggle',
  await now(),
);

const beforeConvertBack = await now();
click(
  label('Toggle')
    .closest('.mindmap-node')
    .querySelector('[aria-label="Remove checkbox"]'),
);
await written(beforeConvertBack);
check(
  'the action bar converts a task back into a list item',
  (await now()) === '- Toggle',
  await now(),
);

await setFile('- [ ] Task');
const task = label('Task')?.closest('.mindmap-node');

task?.dispatchEvent(new PointerEvent('pointerenter'));
const taskActions = await until(() =>
  getComputedStyle(task?.querySelector('.mindmap-node-actions')).display ===
  'flex'
    ? task.querySelector('.mindmap-node-actions')
    : null,
);
const taskMetadata = task?.querySelector('.mindmap-task-metadata');
const taskActionLabels = [...taskActions.children].map((control) =>
  control.getAttribute('aria-label'),
);

check(
  'the existing task controls share the extended action bar',
  taskMetadata === taskActions &&
    !!taskActions.querySelector('.lucide-flag') &&
    !!taskActions.querySelector('.lucide-calendar-days') &&
    taskActionLabels.join(',') ===
      'Add child,Add sibling,Remove checkbox,Set priority,Set due date,More actions',
  taskActionLabels.join(', '),
);
const taskControlStyles = [...taskActions.children].map(controlStyle);
check(
  'task and common actions use the same button treatment',
  [...commonControlStyles, ...taskControlStyles].every(
    (style) => JSON.stringify(style) === JSON.stringify(commonControlStyles[0]),
  ),
  JSON.stringify({ commonControlStyles, taskControlStyles }),
);
click(taskActions.querySelector('[aria-label="Set priority"]'));
const priorityItem = await until(() =>
  [
    ...view.containerEl.doc.querySelectorAll(
      '.mindmap-task-priority-picker button',
    ),
  ].find((item) => item.textContent === '▲ High'),
);
check('the integrated priority action opens its picker', !!priorityItem);

const beforeActionDate = await now();

click(taskActions.querySelector('[aria-label="Set due date"]'));
const actionCalendar = await until(() =>
  view.containerEl.doc.querySelector('.mindmap-task-date-picker'),
);
click(actionCalendar.querySelector('[aria-label="Next month"]'));
click(actionCalendar.querySelector('[data-date="2026-11-01"]'));
await written(beforeActionDate);
check(
  'the action-bar calendar writes the selected date',
  (await now()) === '- [ ] Task 📅 2026-11-01',
  await now(),
);
const datedTask = label('Task').closest('.mindmap-node');
const datedActions = datedTask.querySelector('.mindmap-node-actions');
check(
  'set and unset due date controls use the same calendar icon',
  [...datedTask.querySelectorAll('.mindmap-task-due-date')].every(
    (control) => !!control.querySelector('.lucide-calendar-days'),
  ),
);
check(
  'task metadata actions keep their positions after setting a date',
  [...datedActions.children]
    .map((control) => control.getAttribute('aria-label'))
    .join(',') ===
    'Add child,Add sibling,Remove checkbox,Set priority,Change due date, 2026-11-01,More actions',
);
click(datedTask);
await settle();
focusMap();
click(
  label('Task')
    .closest('.mindmap-node')
    .querySelector('.mindmap-node-actions .mindmap-task-priority'),
);
await until(() => view.priorityMenu);
await press('Escape');
check('Escape dismisses the priority picker', !view.priorityMenu?.isConnected);

click(
  label('Task')
    .closest('.mindmap-node')
    .querySelector('.mindmap-node-actions .mindmap-task-due-date'),
);
await until(() => view.taskDatePicker);
view.taskDatePicker.querySelector('[data-date]').focus();
const beforePickerKeys = await now();
await press('Delete');
await press('Backspace');
await settle();
check(
  'calendar keys do not delete the selected task',
  (await now()) === beforePickerKeys,
);
await press('Escape');
check('Escape dismisses the calendar', !view.taskDatePicker?.isConnected);

click(
  label('Task')
    .closest('.mindmap-node')
    .querySelector('.mindmap-node-actions .mindmap-task-priority'),
);
await until(() => view.priorityMenu);
await drawn();
check(
  'rendering dismisses the priority picker',
  !view.priorityMenu?.isConnected,
);

click(
  label('Task')
    .closest('.mindmap-node')
    .querySelector('.mindmap-node-actions .mindmap-task-priority'),
);
await until(() => view.priorityMenu);
view.scrollerEl.dispatchEvent(
  new PointerEvent('pointerdown', { bubbles: true }),
);
check(
  'an outside pointer closes the priority picker',
  !view.priorityMenu?.isConnected,
);
view.scrollerEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));

click(label('Task').closest('.mindmap-node'));
await settle();
focusMap();
const inlineDueAnchor = label('Task')
  .closest('.mindmap-node')
  .querySelector(
    '.mindmap-task-metadata:not(.mindmap-node-actions) .mindmap-task-due-date',
  );
check(
  'unset inline priority uses an icon instead of plus text',
  !!inlineDueAnchor.parentElement.querySelector(
    '.mindmap-task-priority .lucide-flag',
  ) &&
    !inlineDueAnchor.parentElement.querySelector('.mindmap-task-priority')
      .textContent,
);
inlineDueAnchor.focus();
click(inlineDueAnchor);
await until(() => view.taskDatePicker);
check(
  'opening the inline calendar focuses its date controls',
  view.taskDatePicker.contains(view.canvasEl.doc.activeElement),
);
inlineDueAnchor.focus();
const beforeAnchorKeys = await now();
await press('Delete');
await press('Backspace');
await settle();
check(
  'calendar anchor keys preserve the selected task',
  view.selectedLine === 0 && (await now()) === beforeAnchorKeys,
  JSON.stringify({ selected: view.selectedLine, text: await now() }),
);
await press('Escape');

click(
  label('Task')
    .closest('.mindmap-node')
    .querySelector('[aria-label="More actions"]'),
);
const noteMenuItem = await until(() =>
  [...view.canvasEl.doc.querySelectorAll('.menu-item')].find(
    (item) =>
      item.querySelector('.menu-item-title')?.textContent === 'Add note',
  ),
);
click(noteMenuItem);
check(
  'the full menu still opens node note editing',
  !!(await until(() => view.mirroredCursor)),
);
view.endBodyEdit();
const temporaryLeaf = app.workspace.getLeaf('split', 'vertical');
await temporaryLeaf.setViewState({
  type: 'mindmap-editor',
  state: { file: file.path },
  active: true,
});
const temporaryView = temporaryLeaf.view;
await until(() => temporaryView.root && temporaryView.laidByLine.size);
const temporaryTask = temporaryView.root.children[0];
temporaryView.showPriorityMenu(
  null,
  temporaryTask,
  temporaryView.laidByLine.get(temporaryTask.line).el,
);
const closingPicker = temporaryView.priorityMenu;
await temporaryLeaf.detach();
check(
  'closing the map removes its priority picker',
  !closingPicker.isConnected,
);
await app.workspace.revealLeaf(view.leaf);
focusMap();
await restore();

return { results };
