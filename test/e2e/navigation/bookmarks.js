/** Bookmarks follow Obsidian edits with no map open, then reveal their node. */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

const plugin = app.plugins.getPlugin('mindmap-editor');
const originalText = await now();
const originalBookmarks = structuredClone(plugin.settings.bookmarks);
let mapLeaf = view.leaf;

try {
  plugin.settings.bookmarks = [];
  await plugin.saveSettings();
  await drawn();
  const target = await until(() =>
    [...view.canvasEl.querySelectorAll('.mindmap-node-text')].find(
      (entry) => entry.textContent === 'plain item',
    ),
  );

  const nodeEl = target?.closest('.mindmap-node');
  const node = view.laidByLine.get(Number(nodeEl?.dataset.line))?.node;

  await plugin.addBookmark(file, node, originalText);
  check(
    'adding a node persists its bookmark',
    await until(() => plugin.settings.bookmarks[0]?.text === 'plain item'),
    JSON.stringify(plugin.settings.bookmarks),
  );

  mapLeaf.detach();
  editor.setValue(originalText.replace('- plain item', '- renamed bookmark'));
  await md.view.save();
  check(
    'an Obsidian edit follows a bookmark while its map is closed',
    await until(
      () => plugin.settings.bookmarks[0]?.text === 'renamed bookmark',
      5000,
    ),
    JSON.stringify(plugin.settings.bookmarks[0]),
  );

  await plugin.openMindmap(file, false, md);
  mapLeaf = app.workspace
    .getLeavesOfType('mindmap-editor')
    .find((leaf) => leaf.view.currentFile?.path === file.path);
  window.__mindmapE2EFixture.map = mapLeaf;
  await app.workspace.revealLeaf(mapLeaf);
  const reopened = mapLeaf.view;
  const focusReopened = async () => {
    await until(() => reopened.pointing === 0);
    app.workspace.setActiveLeaf(reopened.leaf, { focus: true });
    reopened.scrollerEl.focus({ preventScroll: true });
    await until(
      () =>
        app.workspace.getActiveViewOfType(reopened.constructor) === reopened &&
        reopened.containerEl.doc.activeElement === reopened.scrollerEl,
    );
  };

  await until(
    () =>
      reopened.viewportReady &&
      !reopened.renderQueued &&
      reopened.contentEl.querySelector('.mindmap-node-text'),
    5000,
  );
  const mod = navigator.platform.includes('Mac')
    ? { metaKey: true }
    : { ctrlKey: true };
  const renamedLabel = [
    ...reopened.canvasEl.querySelectorAll('.mindmap-node-text'),
  ].find((entry) => entry.textContent === 'renamed bookmark');

  key('Escape');
  await until(() => !reopened.containerEl.doc.querySelector('.menu'));
  click(renamedLabel);
  await until(() =>
    reopened.canvasEl.querySelector('.mindmap-node.is-selected'),
  );
  await focusReopened();
  await press('B', mod);
  check(
    'Ctrl/Cmd+B removes the bookmark',
    (await until(() => plugin.settings.bookmarks.length === 0)) &&
      (await until(
        () => !reopened.canvasEl.querySelector('.mindmap-bookmark-mark'),
      )),
    JSON.stringify(plugin.settings.bookmarks),
  );
  await focusReopened();
  await press('B', mod);
  check(
    'Ctrl/Cmd+B adds the bookmark',
    (await until(
      () => plugin.settings.bookmarks[0]?.text === 'renamed bookmark',
    )) &&
      (await until(() =>
        reopened.canvasEl.querySelector('.mindmap-bookmark-mark'),
      )),
    JSON.stringify(plugin.settings.bookmarks),
  );
  const bookmarkMark = await until(() =>
    reopened.canvasEl.querySelector('.mindmap-bookmark-mark'),
  );
  const markedNode = reopened.laidByLine.get(
    plugin.settings.bookmarks[0]?.line,
  )?.el;
  const markBox = bookmarkMark?.getBoundingClientRect();
  const nodeBox = markedNode?.getBoundingClientRect();
  check(
    'bookmark mark is centered on the node top-left corner',
    markBox &&
      nodeBox &&
      Math.abs(markBox.left + markBox.width / 2 - nodeBox.left) < 0.5 &&
      Math.abs(markBox.top + markBox.height / 2 - nodeBox.top) < 0.5,
    `mark ${JSON.stringify(markBox?.toJSON())}; node ${JSON.stringify(nodeBox?.toJSON())}`,
  );
  reopened.viewport.restore(0.5);
  const bookmarkAction = reopened.containerEl.querySelector(
    '[aria-label="Node bookmarks"]',
  );

  bookmarkAction.click();
  const bookmarkItem = await until(() =>
    [...reopened.containerEl.doc.querySelectorAll('.menu-item')].find(
      (item) =>
        item.querySelector('.menu-item-title')?.textContent ===
        'renamed bookmark',
    ),
  );

  check(
    'bookmark menu shows the Markdown node kind icon',
    bookmarkItem?.querySelector('.menu-item-icon svg'),
    bookmarkItem?.innerHTML ??
      [...reopened.containerEl.doc.querySelectorAll('.menu-item-title')]
        .map((item) => item.textContent)
        .join(', '),
  );
  check(
    'bookmark menu shows its remove icon',
    bookmarkItem?.querySelector('.mindmap-bookmark-remove svg'),
    bookmarkItem?.innerHTML ??
      [...reopened.containerEl.doc.querySelectorAll('.menu-item-title')]
        .map((item) => item.textContent)
        .join(', '),
  );
  key('Escape');
  await until(() => !reopened.containerEl.doc.querySelector('.menu'));
  const mapLabel = [
    ...reopened.canvasEl.querySelectorAll('.mindmap-node-text'),
  ].find((entry) => entry.textContent === 'renamed bookmark');

  click(mapLabel);
  await wait(80);
  click(mapLabel, 'dblclick');
  const mapEditor = await until(() =>
    reopened.canvasEl.querySelector('.mindmap-edit-input'),
  );

  type(mapEditor, 'map renamed bookmark');
  await until(async () => (await now()).includes('- map renamed bookmark'));
  const renamedBookmark = await until(
    () =>
      plugin.settings.bookmarks[0]?.text === 'map renamed bookmark' &&
      plugin.settings.bookmarks[0],
    5000,
  );
  mapEditor.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await until(() => !reopened.canvasEl.querySelector('.mindmap-edit-input'));
  check(
    'an edit made on the map updates the bookmark',
    renamedBookmark,
    JSON.stringify(plugin.settings.bookmarks),
  );
  if (renamedBookmark) {
    await reopened.revealBookmark(renamedBookmark);
  }
  const selected = await until(() => {
    const current = reopened.contentEl.querySelector(
      '.mindmap-node.is-selected',
    );
    const port = reopened.scrollerEl.getBoundingClientRect();
    const box = current?.getBoundingClientRect();

    return (
      box &&
      Math.abs(box.left + box.width / 2 - (port.left + port.width / 2)) < 2 &&
      Math.abs(box.top + box.height / 2 - (port.top + port.height / 2)) < 2 &&
      current
    );
  });

  check(
    'choosing a bookmark selects, centers, and makes its node readable',
    selected?.textContent.includes('map renamed bookmark') &&
      reopened.viewport.value === 1,
    `selected ${selected?.textContent}; zoom ${reopened.viewport.value}`,
  );
} finally {
  editor.setValue(originalText);
  await md.view.save();
  plugin.settings.bookmarks = originalBookmarks;
  await plugin.saveSettings();
  if (!mapLeaf?.view?.currentFile) {
    await plugin.openMindmap(file, false, md);
    mapLeaf = app.workspace
      .getLeavesOfType('mindmap-editor')
      .find((leaf) => leaf.view.currentFile?.path === file.path);
  }
  window.__mindmapE2EFixture.map = mapLeaf;
}

return { results };
