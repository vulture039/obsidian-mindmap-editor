/** Saved positions survive closing, hidden state updates, and file switches. */
const viewportKey = (path) => `mindmap-editor:viewport:${path}`;
const paths = ['Fixtures.md', 'Linked.md'];
const plugin = app.plugins.getPlugin('mindmap-editor');
const originalBookmarks = [...plugin.settings.autoOpenFiles];
plugin.settings.autoOpenFiles = originalBookmarks.filter(
  (path) => !paths.includes(path),
);
const saved = paths.map((path) => app.loadLocalStorage(viewportKey(path)));
const created = [];
const storedState = async (id) => {
  const layout = JSON.parse(
    await app.vault.adapter.read(`${app.vault.configDir}/workspace.json`),
  );
  const pending = [layout];

  while (pending.length) {
    const entry = pending.pop();

    if (!entry || typeof entry !== 'object') continue;
    if (entry.id === id) return entry.state?.state;
    pending.push(...Object.values(entry));
  }

  return null;
};
const same = (actual, expected) =>
  actual &&
  Math.abs(actual.zoom - expected.zoom) < 0.001 &&
  Math.abs(actual.left - expected.left) < 1 &&
  Math.abs(actual.top - expected.top) < 1;
const ready = async (leaf) => {
  if (
    !(await until(
      () =>
        leaf.view.viewportReady &&
        !leaf.view.renderQueued &&
        leaf.view.layoutBuildSeq === null &&
        leaf.view.revealTimer === null &&
        leaf.view.contentEl.offsetHeight > 0,
      5000,
    ))
  ) {
    throw new Error('The test map did not finish its visible layout');
  }
};
const open = async (state = { file: paths[0] }) => {
  const leaf = app.workspace.getLeaf('tab');

  created.push(leaf);
  await leaf.setViewState({ type: 'mindmap-editor', active: true, state });
  await app.workspace.revealLeaf(leaf);
  leaf.view.initialViewportAfterReveal(null);
  await ready(leaf);

  return leaf;
};
const hide = async (leaf) => {
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const cover = app.workspace.getLeaf('tab');

  created.push(cover);
  await cover.setViewState({ type: 'empty', active: true });
  await app.workspace.revealLeaf(cover);
  if (!(await until(() => leaf.view.contentEl.offsetHeight === 0))) {
    throw new Error('The test tab did not become hidden');
  }
};

try {
  for (const path of paths) app.saveLocalStorage(viewportKey(path), null);
  let leaf = await open();
  const scroller = leaf.view.contentEl.querySelector('.mindmap-scroller');

  if (!(await until(() => storedState(leaf.id), 5000))) {
    throw new Error('The test tab was not saved in the workspace');
  }
  leaf.view.viewport.restore(1.25);
  scroller.scrollLeft = 2350;
  scroller.scrollTop = 2475;
  const first = leaf.view.viewport.snapshot();

  check(
    'scrolling persists zoom and both offsets on this device',
    await until(() => same(app.loadLocalStorage(viewportKey(paths[0])), first)),
  );
  check(
    'scrolling updates the saved workspace without another tab operation',
    await until(
      async () => same((await storedState(leaf.id))?.viewport, first),
      5000,
    ),
  );
  leaf.detach();
  leaf = await open();
  check(
    'closing and reopening the same map restores its viewport',
    same(leaf.view.viewport.snapshot(), first),
    JSON.stringify(leaf.view.viewport.snapshot()),
  );

  await hide(leaf);
  const next = { zoom: 0.8, left: 2510, top: 2620 };

  await leaf.view.setState({ file: paths[0], viewport: next }, {});
  const hiddenState = leaf.view.getState();

  check(
    'a hidden tab serializes the newly requested viewport',
    hiddenState.zoom === next.zoom && same(hiddenState.viewport, next),
    JSON.stringify(hiddenState),
  );
  leaf.detach();
  check(
    'closing a hidden tab saves the newly requested viewport',
    same(app.loadLocalStorage(viewportKey(paths[0])), next),
    JSON.stringify(app.loadLocalStorage(viewportKey(paths[0]))),
  );
  leaf = await open();
  check(
    'reopening a hidden-then-closed tab uses its latest saved position',
    same(leaf.view.viewport.snapshot(), next),
    JSON.stringify(leaf.view.viewport.snapshot()),
  );
  leaf.detach();
  leaf = await open(hiddenState);
  check(
    'serialized workspace state restores the hidden update',
    same(leaf.view.viewport.snapshot(), next),
    JSON.stringify(leaf.view.viewport.snapshot()),
  );

  const other = { zoom: 1.1, left: 2200, top: 2300 };

  app.saveLocalStorage(viewportKey(paths[1]), other);
  await leaf.view.setFile(app.vault.getAbstractFileByPath(paths[1]));
  await ready(leaf);
  check(
    'switching files restores the other map’s own position',
    same(leaf.view.viewport.snapshot(), other),
    JSON.stringify(leaf.view.viewport.snapshot()),
  );
  await leaf.view.setFile(file);
  await ready(leaf);
  check(
    'switching back preserves the first map’s position',
    same(leaf.view.viewport.snapshot(), next),
    JSON.stringify(leaf.view.viewport.snapshot()),
  );
} finally {
  plugin.settings.autoOpenFiles = originalBookmarks;
  for (const leaf of created.reverse()) leaf.detach();
  await app.workspace.revealLeaf(view.leaf);
  await settle();
  paths.forEach((path, index) =>
    app.saveLocalStorage(viewportKey(path), saved[index] ?? null),
  );
}

return { results };
