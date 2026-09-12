/** A first opening centers its caret and starts saving the viewport. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const bookmarks = [...plugin.settings.autoOpenFiles];
const remember = plugin.settings.rememberLinkedMaps;
const storageKey = `mindmap-editor:viewport:${file.path}`;
const stored = app.loadLocalStorage(storageKey);
let source;
let opened;

try {
  plugin.settings.autoOpenFiles = bookmarks.filter(
    (path) => path !== file.path,
  );
  plugin.settings.rememberLinkedMaps = false;
  app.saveLocalStorage(storageKey, null);
  source = app.workspace.getLeaf('tab');
  await source.openFile(file);
  await app.workspace.revealLeaf(source);
  source.view.editor.setCursor({ line: 32, ch: 0 });
  source.view.editor.focus();
  const before = app.workspace.getLeavesOfType('mindmap-editor');

  await plugin.openMindmap(file, true, source);
  opened = app.workspace
    .getLeavesOfType('mindmap-editor')
    .find((leaf) => !before.includes(leaf));
  await until(
    () =>
      opened?.view.viewportReady &&
      !opened.view.renderQueued &&
      opened.view.revealTimer === null &&
      opened.view.layoutBuildSeq === null,
    5000,
  );
  const map = opened?.view;
  const box = map?.canvasEl
    .querySelector('.mindmap-node.is-selected')
    ?.getBoundingClientRect();
  const port = map?.scrollerEl.getBoundingClientRect();

  check(
    'opening an unbookmarked note centers the cursor node',
    box &&
      port &&
      Math.abs(box.left + box.width / 2 - port.left - port.width / 2) < 1 &&
      Math.abs(box.top + box.height / 2 - port.top - port.height / 2) < 1,
    JSON.stringify({
      box,
      port,
      selected: map?.selectedLine,
      cursor: source.view.editor.getCursor(),
      zoom: map?.viewport.value,
      pending: map?.revealPending,
    }),
  );
  check(
    'opening an unbookmarked note starts at 100% zoom',
    map?.viewport.value === 1,
    `zoom ${map?.viewport.value}`,
  );
  check(
    'the opening remains split from its Markdown source',
    opened &&
      opened.parent !== source.parent &&
      source.view.contentEl.offsetHeight > 0,
  );
  check(
    'an unbookmarked map serializes its position',
    JSON.stringify(map?.getState().viewport) ===
      JSON.stringify(map?.viewport.snapshot()),
  );
  check(
    'an unbookmarked map saves its position',
    JSON.stringify(app.loadLocalStorage(storageKey)) ===
      JSON.stringify(map?.viewport.snapshot()),
  );
} finally {
  opened?.detach();
  source?.detach();
  plugin.settings.autoOpenFiles = bookmarks;
  plugin.settings.rememberLinkedMaps = remember;
  app.saveLocalStorage(storageKey, stored ?? null);
  await app.workspace.revealLeaf(view.leaf);
}

return { results };
