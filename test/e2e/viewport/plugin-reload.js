/** CSS is removed before Obsidian captures the old view during plugin reload. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const originalBookmarks = [...plugin.settings.autoOpenFiles];
const previousState = view.getState();
const leafId = view.leaf.id;
const storageKey = `mindmap-editor:viewport:${file.path}`;
const currentMap = () =>
  app.workspace
    .getLeavesOfType('mindmap-editor')
    .find((leaf) => leaf.id === leafId)?.view;

try {
  plugin.settings.autoOpenFiles = [
    ...new Set([...originalBookmarks, file.path]),
  ];
  await plugin.saveSettings();
  view.fit();
  await settle();
  const before = view.viewport.snapshot();
  const same = (position) =>
    position &&
    position.zoom === before.zoom &&
    Math.abs(position.left - before.left) < 1 &&
    Math.abs(position.top - before.top) < 1;

  await app.plugins.disablePlugin('mindmap-editor');
  check(
    'unloading CSS does not overwrite stored offsets with zeros',
    same(app.loadLocalStorage(storageKey)),
    JSON.stringify(app.loadLocalStorage(storageKey)),
  );
  await app.plugins.enablePlugin('mindmap-editor');
  const restored = await until(() => {
    const map = currentMap();

    return (
      map?.viewportReady &&
      map.revealTimer === null &&
      !map.renderQueued &&
      map.layoutBuildSeq === null &&
      map
    );
  }, 5000);

  check(
    'reloading restores the same viewport',
    restored && same(restored.viewport.snapshot()),
  );
  const port = restored?.scrollerEl.getBoundingClientRect();
  const visible =
    restored &&
    [...restored.canvasEl.querySelectorAll('.mindmap-node')].some((node) => {
      const box = node.getBoundingClientRect();

      return (
        box.width > 0 &&
        box.height > 0 &&
        box.right > port.left &&
        box.left < port.right &&
        box.bottom > port.top &&
        box.top < port.bottom
      );
    });

  check('nodes remain visible after plugin reload', visible);
} finally {
  if (!app.plugins.getPlugin('mindmap-editor')) {
    await app.plugins.enablePlugin('mindmap-editor');
  }
  const restoredPlugin = app.plugins.getPlugin('mindmap-editor');
  restoredPlugin.settings.autoOpenFiles = originalBookmarks;
  await restoredPlugin.saveSettings();
  const map = await until(() => currentMap());

  if (map) await map.setState(previousState, {});
}

return { results };
