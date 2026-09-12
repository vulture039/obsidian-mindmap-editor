/** Initial framing after a new stacked split changes the source pane height. */
const plugin = app.plugins.getPlugin('mindmap-editor');

if (!plugin) {
  return fail('the mindmap-editor plugin is not loaded');
}
const originalDirection = plugin.settings.splitDirection;
const originalAutoOpenFiles = [...plugin.settings.autoOpenFiles];
const originalRememberLinkedMaps = plugin.settings.rememberLinkedMaps;
const originalCursor = editor.getCursor();
const source = md;

try {
  for (const leaf of app.workspace.getLeavesOfType('mindmap-editor')) {
    leaf.detach();
  }
  await until(
    () => app.workspace.getLeavesOfType('mindmap-editor').length === 0,
  );
  plugin.settings.splitDirection = 'horizontal';
  plugin.settings.autoOpenFiles = [];
  plugin.settings.rememberLinkedMaps = false;
  editor.setCursor({ line: 32, ch: 0 });
  app.workspace.setActiveLeaf(source, { focus: true });
  app.commands.executeCommandById('mindmap-editor:open-mindmap-linked');
  const opened = await until(
    () => app.workspace.getLeavesOfType('mindmap-editor')[0],
  );
  const cursorVisible = await until(() => {
    const line = [...source.view.containerEl.querySelectorAll('.cm-line')].find(
      (el) => el.textContent?.includes('github.com/vulture039'),
    );
    const scroller = source.view.containerEl.querySelector('.cm-scroller');
    const box = line?.getBoundingClientRect();
    const port = scroller?.getBoundingClientRect();

    return (
      !!opened &&
      !!box &&
      !!port &&
      box.top >= port.top &&
      box.bottom <= port.bottom
    );
  });

  check(
    'a stacked map split keeps the Markdown cursor line visible',
    cursorVisible,
    `opened ${!!opened}, cursor visible ${!!cursorVisible}`,
  );
} finally {
  plugin.settings.splitDirection = originalDirection;
  plugin.settings.autoOpenFiles = originalAutoOpenFiles;
  plugin.settings.rememberLinkedMaps = originalRememberLinkedMaps;
  editor.setCursor(originalCursor);
  for (const leaf of app.workspace.getLeavesOfType('mindmap-editor')) {
    leaf.detach();
  }
  app.workspace.setActiveLeaf(source, { focus: true });
  app.commands.executeCommandById('mindmap-editor:open-mindmap');
  await until(
    () =>
      app.workspace.getLeavesOfType('mindmap-editor')[0]?.view.currentFile
        ?.path === 'Fixtures.md',
  );
}

return { results };
