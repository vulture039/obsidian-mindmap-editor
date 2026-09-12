/** A read begun in a visible tab must not use hidden scroll/layout metrics. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const originalBookmarks = [...plugin.settings.autoOpenFiles];
plugin.settings.autoOpenFiles = [...new Set([...originalBookmarks, file.path])];
const initialPosition = view.viewport.snapshot();
const originalRead = view.getFileText;
const originalImages = view.waitForRenderedImages;
let releaseRead;
let releaseImages;
let cover;

try {
  await app.workspace.revealLeaf(view.leaf);
  await view.forceRefresh();
  view.fit();
  await settle();
  view.saveViewport();
  const before = view.viewport.snapshot();
  let readStarted = false;
  let imagesStarted = false;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const imageGate = new Promise((resolve) => {
    releaseImages = resolve;
  });

  view.getFileText = async function (switched) {
    const text = await originalRead.call(this, switched);

    readStarted = true;
    await readGate;

    return text;
  };
  view.waitForRenderedImages = async () => {
    imagesStarted = true;
    await imageGate;
  };
  const rendering = view.forceRefresh();

  await until(() => readStarted);
  cover = app.workspace.createLeafInParent(view.leaf.parent, -1);
  await cover.setViewState({ type: 'empty', active: true });
  await app.workspace.revealLeaf(cover);
  check(
    'the map is hidden while its file read completes',
    view.contentEl.offsetHeight === 0,
  );
  releaseRead();
  await until(() => view.renderQueued || imagesStarted);
  check(
    'hidden read completion defers rendering',
    view.renderQueued && !imagesStarted,
  );
  await app.workspace.revealLeaf(view.leaf);
  releaseImages();
  await rendering;
  await until(() => !view.renderQueued && view.layoutBuildSeq === null);
  await settle();
  const after = view.viewport.snapshot();
  const stored = app.loadLocalStorage(
    `mindmap-editor:viewport:${view.file.path}`,
  );
  const same = (position) =>
    position &&
    position.zoom === before.zoom &&
    Math.abs(position.left - before.left) < 1 &&
    Math.abs(position.top - before.top) < 1;

  check(
    'revealing during asynchronous rendering preserves the viewport',
    same(after),
    JSON.stringify({ before, after }),
  );
  check(
    'asynchronous rendering does not persist hidden zero offsets',
    same(stored),
    JSON.stringify(stored),
  );

  view.getFileText = originalRead;
  imagesStarted = false;
  const hiddenImageGate = new Promise((resolve) => {
    releaseImages = resolve;
  });

  view.waitForRenderedImages = async () => {
    imagesStarted = true;
    await hiddenImageGate;
  };
  const imageRendering = view.forceRefresh();

  await until(() => imagesStarted);
  await app.workspace.revealLeaf(cover);
  releaseImages();
  await imageRendering;
  check('hidden image completion defers layout measurement', view.renderQueued);
  view.waitForRenderedImages = originalImages;
  await app.workspace.revealLeaf(view.leaf);
  await until(() => !view.renderQueued && view.layoutBuildSeq === null);
  check(
    'image completion preserves position on reveal',
    same(view.viewport.snapshot()),
  );
} finally {
  plugin.settings.autoOpenFiles = originalBookmarks;
  releaseRead?.();
  releaseImages?.();
  view.getFileText = originalRead;
  view.waitForRenderedImages = originalImages;
  cover?.detach();
  await app.workspace.revealLeaf(view.leaf);
  await view.forceRefresh();
  view.viewport.restorePosition(initialPosition);
}

return { results };
