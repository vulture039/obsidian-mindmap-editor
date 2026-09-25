/** A map keeps its selected node visible while its Markdown pane opens/closes. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const path = 'E2E Selected Pane.md';
const existing = app.vault.getAbstractFileByPath(path);
const created = [];

if (!plugin) {
  return fail('the mindmap-editor plugin is not loaded');
}
if (existing) await app.vault.delete(existing, true);
const testFile = await app.vault.create(
  path,
  '# Root\n\n## First\n\n- [ ] Selected target\n\n## Last\n',
);
const centered = (map, node) => {
  const selected =
    node ?? map?.contentEl.querySelector('.mindmap-node.is-selected');
  const box = selected?.getBoundingClientRect();
  const port = map?.scrollerEl.getBoundingClientRect();

  return (
    !!box &&
    !!port &&
    Math.abs(box.left + box.width / 2 - (port.left + port.width / 2)) < 3 &&
    Math.abs(box.top + box.height / 2 - (port.top + port.height / 2)) < 3
  );
};
const visible = (map) => {
  const surface = map?.contentEl.querySelector('.mindmap-surface');

  return (
    surface && surface.win.getComputedStyle(surface).visibility !== 'hidden'
  );
};

try {
  const map = app.workspace.createLeafBySplit(view.leaf, 'vertical');

  created.push(map);
  await map.setViewState({
    type: 'mindmap-editor',
    active: true,
    state: { file: path },
  });
  await app.workspace.revealLeaf(map);

  if (map.view.currentFile?.path !== path) {
    return fail('the dedicated map did not open');
  }
  await until(
    () =>
      map.view.viewportReady &&
      !map.view.renderQueued &&
      map.view.layoutBuildSeq === null,
    5000,
  );
  await app.workspace.revealLeaf(map);
  const target = await until(() =>
    [...map.view.contentEl.querySelectorAll('.mindmap-node-text')].find(
      (el) => el.textContent === 'Selected target',
    ),
  );

  click(target);
  const opened = await until(() =>
    app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view.file?.path === path),
  );
  const afterOpen = await until(() => centered(map.view), 5000);
  const openingSelected = map.view.contentEl.querySelector(
    '.mindmap-node.is-selected',
  );
  const openingBox = openingSelected?.getBoundingClientRect();
  const openingPort = map.view.scrollerEl.getBoundingClientRect();
  check(
    'opening Markdown keeps the selected node centered',
    !!opened && !!afterOpen,
    JSON.stringify({
      selected: !!openingSelected,
      selectedLine: map.view.selectedLine,
      mapFile: map.view.file?.path,
      offset:
        openingBox && openingPort
          ? [
              openingBox.left - openingPort.left,
              openingBox.top - openingPort.top,
            ]
          : null,
    }),
  );

  opened?.detach();
  app.workspace.trigger('layout-change');
  const afterClose = await until(
    () => visible(map.view) && centered(map.view),
    5000,
  );
  const selected = map.view.contentEl.querySelector(
    '.mindmap-node.is-selected',
  );
  const box = selected?.getBoundingClientRect();
  const port = map.view.scrollerEl.getBoundingClientRect();
  check(
    'closing Markdown keeps the selected node visible and centered',
    !!afterClose,
    JSON.stringify({
      visibility: map.view.contentEl
        .querySelector('.mindmap-surface')
        ?.win.getComputedStyle(
          map.view.contentEl.querySelector('.mindmap-surface'),
        ).visibility,
      selected: !!selected,
      selectedLine: map.view.selectedLine,
      mapFile: map.view.file?.path,
      offset: box && port ? [box.left - port.left, box.top - port.top] : null,
      size: [map.view.scrollerEl.clientWidth, map.view.scrollerEl.clientHeight],
    }),
  );

  const task = map.view.laidByLine.get(map.view.selectedLine)?.node;

  await map.view.addTaskNote(task);
  const noteEditor = await until(() =>
    app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.view.file?.path === path),
  );
  const noteSelected = map.view.contentEl.querySelector(
    '.mindmap-node.is-selected',
  );
  const noteBox = noteSelected?.getBoundingClientRect();
  const notePort = map.view.scrollerEl.getBoundingClientRect();
  check(
    'adding a task note keeps the task centered while Markdown opens',
    !!noteEditor &&
      !!(await until(
        () => centered(map.view, map.view.laidByLine.get(task?.line)?.el),
        5000,
      )),
    JSON.stringify({
      task: task?.text,
      selectedLine: map.view.selectedLine,
      selected: !!noteSelected,
      offset:
        noteBox && notePort
          ? [noteBox.left - notePort.left, noteBox.top - notePort.top]
          : null,
    }),
  );

  const scroller = map.view.scrollerEl;

  scroller.scrollLeft += 120;
  scroller.scrollTop += 60;
  const position = [scroller.scrollLeft, scroller.scrollTop];
  const first = [
    ...map.view.contentEl.querySelectorAll('.mindmap-node-text'),
  ].find((el) => el.textContent === 'First');

  click(first);
  await until(
    () => first?.closest('.mindmap-node')?.hasClass('is-selected'),
    5000,
  );
  await settle();
  check(
    'selecting a node with Markdown already open keeps the map position',
    scroller.scrollLeft === position[0] && scroller.scrollTop === position[1],
    `${position.join(', ')} became ${scroller.scrollLeft}, ${scroller.scrollTop}`,
  );
  noteEditor?.detach();
} finally {
  for (const leaf of created.reverse()) leaf.detach();
  await app.vault.delete(testFile, true);
  await app.workspace.revealLeaf(view.leaf);
}

return { results };
