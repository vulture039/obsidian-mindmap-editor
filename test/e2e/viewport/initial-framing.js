/** Initial framing restores saved positions and resets ordinary cursor zoom. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const originalBookmarks = [...plugin.settings.autoOpenFiles];
const storageKey = 'mindmap-editor:viewport:Fixtures.md';
const savedPosition = app.loadLocalStorage(storageKey);
let opened;

try {
  for (const scenario of [
    'new',
    'offscreen',
    'cursor',
    'linked',
    'workspace-state',
  ]) {
    plugin.settings.autoOpenFiles = originalBookmarks.filter(
      (path) => path !== 'Fixtures.md',
    );
    if (scenario === 'offscreen') {
      app.saveLocalStorage(storageKey, { zoom: 1, left: 0, top: 0 });
    } else {
      app.saveLocalStorage(storageKey, null);
    }
    opened = app.workspace.getLeaf('tab');
    await opened.setViewState({
      type: 'mindmap-editor',
      active: true,
      state: {
        file: 'Fixtures.md',
        ...(scenario === 'workspace-state'
          ? {
              zoom: 0.65,
              viewport: { zoom: 0.65, left: 2200, top: 2300 },
            }
          : {}),
      },
    });
    await app.workspace.revealLeaf(opened);
    const map = opened.view;

    // The opening command can resume after linking and fold restoration.
    await until(() => map.viewportReady && map.revealTimer === null);
    if (scenario === 'linked') {
      // `linkToEditor` does this before initialViewportAfterReveal when
      // Remember linked maps is enabled.
      plugin.settings.autoOpenFiles.push('Fixtures.md');
    }
    if (scenario !== 'new') {
      map.initialViewportAfterReveal(
        ['cursor', 'linked', 'workspace-state'].includes(scenario) ? 32 : null,
      );
    }
    await until(() => map.revealTimer === null && map.layoutBuildSeq === null);
    const port = map.scrollerEl.getBoundingClientRect();
    const visible = (node) => {
      const box = node.getBoundingClientRect();

      return (
        box.width > 0 &&
        box.height > 0 &&
        box.right > port.left &&
        box.left < port.right &&
        box.bottom > port.top &&
        box.top < port.bottom
      );
    };

    if (['cursor', 'linked'].includes(scenario)) {
      const selected = map.canvasEl.querySelector('.mindmap-node.is-selected');

      check(
        'the opening cursor node remains visible',
        selected && visible(selected),
      );
      const box = selected?.getBoundingClientRect();

      check(
        'the opening cursor node is centered',
        box &&
          Math.abs(box.left + box.width / 2 - port.left - port.width / 2) < 1 &&
          Math.abs(box.top + box.height / 2 - port.top - port.height / 2) < 1,
      );
      let zoomName = 'the active opening cursor starts at 100% zoom';

      if (scenario === 'linked') {
        zoomName = 'a newly remembered linked map matches active at 100% zoom';
      }
      check(zoomName, map.viewport.value === 1, `zoom ${map.viewport.value}`);
    } else if (['offscreen', 'workspace-state'].includes(scenario)) {
      const position = map.viewport.snapshot();
      const expected =
        scenario === 'offscreen'
          ? { zoom: 1, left: 0, top: 0 }
          : { zoom: 0.65, left: 2200, top: 2300 };

      check(
        `${scenario}: a saved viewport is restored without modification`,
        position.zoom === expected.zoom &&
          position.left === expected.left &&
          position.top === expected.top,
        JSON.stringify(position),
      );
    } else {
      const initial = map.viewport.snapshot();
      const hasNode = [...map.canvasEl.querySelectorAll('.mindmap-node')].some(
        visible,
      );

      map.fit();
      const fitted = map.viewport.snapshot();

      check(
        `${scenario}: initial framing matches the Fit button`,
        hasNode &&
          Math.abs(initial.zoom - fitted.zoom) < 0.001 &&
          Math.abs(initial.left - fitted.left) < 1 &&
          Math.abs(initial.top - fitted.top) < 1,
        JSON.stringify({ initial, fitted }),
      );
    }
    opened.detach();
    opened = null;
  }
} finally {
  plugin.settings.autoOpenFiles = originalBookmarks;
  opened?.detach();
  await app.workspace.revealLeaf(view.leaf);
  app.saveLocalStorage(storageKey, savedPosition ?? null);
}

return { results };
