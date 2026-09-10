/** Active and linked commands give a fresh map the same cursor viewport. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const path = 'E2E Active Linked.md';
const leftover = app.vault.getAbstractFileByPath(path);

if (!plugin) {
  return fail('setup has no plugin');
}
if (leftover) await app.vault.delete(leftover, true);
const target = await app.vault.create(
  path,
  '# Root\n\nbody\n\n## Cursor target\n- child\n',
);
for (const leaf of app.workspace.getLeavesOfType('mindmap-editor')) {
  if (leaf.view.currentFile?.path === path) leaf.detach();
}
await until(
  () =>
    !app.workspace
      .getLeavesOfType('mindmap-editor')
      .some((leaf) => leaf.view.currentFile?.path === path),
);
const bookmarks = [...plugin.settings.autoOpenFiles];
const remember = plugin.settings.rememberLinkedMaps;
const storageKey = `mindmap-editor:viewport:${path}`;
const stored = app.loadLocalStorage(storageKey);
const created = [];
const centeredOffset = (map) => {
  const node = map?.canvasEl.querySelector('.mindmap-node.is-selected');
  const box = node?.getBoundingClientRect();
  const port = map?.scrollerEl.getBoundingClientRect();

  return box && port
    ? {
        x: box.left + box.width / 2 - port.left - port.width / 2,
        y: box.top + box.height / 2 - port.top - port.height / 2,
      }
    : null;
};
const open = async (linked) => {
  const source = app.workspace.getLeaf('tab');

  created.push(source);
  await source.setViewState({
    type: 'markdown',
    active: false,
    state: { file: path },
  });
  source.view.editor.setCursor({ line: 5, ch: 0 });
  for (const map of app.workspace.getLeavesOfType('mindmap-editor')) {
    if (map.view.currentFile?.path === path) map.detach();
  }
  await until(
    () =>
      !app.workspace
        .getLeavesOfType('mindmap-editor')
        .some((map) => map.view.currentFile?.path === path),
  );
  const before = new Set(app.workspace.getLeavesOfType('mindmap-editor'));

  await plugin.openMindmap(target, linked, source);
  const leaf = await until(() =>
    app.workspace
      .getLeavesOfType('mindmap-editor')
      .find((candidate) => !before.has(candidate)),
  );

  if (leaf && !before.has(leaf)) created.push(leaf);
  await until(
    () =>
      leaf?.view.viewportReady &&
      !leaf.view.renderQueued &&
      leaf.view.revealTimer === null &&
      leaf.view.layoutBuildSeq === null,
    5000,
  );

  return leaf;
};

try {
  plugin.settings.autoOpenFiles = bookmarks.filter((entry) => entry !== path);
  plugin.settings.rememberLinkedMaps = true;
  app.saveLocalStorage(storageKey, null);
  const active = await open(false);
  const activePosition = active?.view.viewport.snapshot();
  const activeOffset = centeredOffset(active?.view);

  active?.detach();
  app.saveLocalStorage(storageKey, null);
  const linked = await open(true);
  const linkedPosition = linked?.view.viewport.snapshot();
  const linkedOffset = centeredOffset(linked?.view);
  const near = (a, b) => Math.abs(a - b) < 1;

  check(
    'active opens its cursor at 100% in the center',
    activePosition?.zoom === 1 &&
      activeOffset &&
      near(activeOffset.x, 0) &&
      near(activeOffset.y, 0),
    JSON.stringify({ activePosition, activeOffset }),
  );
  check(
    'linked opens with the same zoom and position as active',
    activePosition &&
      linkedPosition &&
      linkedOffset &&
      near(linkedPosition.zoom, activePosition.zoom) &&
      near(linkedOffset.x, activeOffset?.x ?? Infinity) &&
      near(linkedOffset.y, activeOffset?.y ?? Infinity),
    JSON.stringify({
      activePosition,
      linkedPosition,
      activeOffset,
      linkedOffset,
    }),
  );
  check(
    'the linked command uses a real Link group and Remember linked maps',
    !!linked?.group && plugin.settings.autoOpenFiles.includes(path),
  );
} finally {
  for (const leaf of created.reverse()) leaf.detach();
  plugin.settings.autoOpenFiles = bookmarks;
  plugin.settings.rememberLinkedMaps = remember;
  app.saveLocalStorage(storageKey, stored ?? null);
  await app.vault.delete(target, true);
}

return { results };
