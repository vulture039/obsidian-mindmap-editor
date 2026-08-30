/** A mobile workspace replaces its active view; it has no split to reveal. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const fail = (detail) => ({
  results: [{ name: 'setup', ok: false, detail }],
});
const until = async (want) => {
  for (const end = Date.now() + 2000; Date.now() <= end;) {
    const got = await want();

    if (got) return got;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  return null;
};
const file = app.vault.getAbstractFileByPath('Fixtures.md');

if (!plugin || !file) {
  return fail('load the plugin and dev-vault/Fixtures.md first');
}
if (!app.isMobile) {
  return fail('switch Obsidian to mobile emulation before this check');
}

for (const command of ['open-mindmap', 'open-mindmap-linked']) {
  await app.workspace.getLeaf(false).openFile(file, { active: true });
  await app.commands.executeCommandById(`mindmap-editor:${command}`);
  const mobileMap = await until(() =>
    app.workspace
      .getLeavesOfType('mindmap-editor')
      .find(
        (leaf) =>
          leaf.containerEl.isShown() &&
          leaf.view.contentEl.querySelectorAll('.mindmap-node').length > 0,
      ),
  );

  check(
    `${command} opens and renders in the mobile workspace`,
    !!mobileMap?.view.contentEl.querySelector('.mindmap-canvas') &&
      mobileMap.view.contentEl.querySelectorAll('.mindmap-node').length > 0,
    `shown ${!!mobileMap}`,
  );
  const shownLeaves = [];

  app.workspace.iterateAllLeaves((leaf) => {
    if (leaf.containerEl.isShown()) shownLeaves.push(leaf);
  });

  check(
    `${command} shows only its map tab instead of splitting`,
    shownLeaves.length === 1 && shownLeaves[0] === mobileMap,
    `${shownLeaves.length} leaves shown`,
  );
  const node = mobileMap?.view.contentEl.querySelector(
    '.mindmap-node:not(.mindmap-node-root)',
  );

  node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  check(
    `${command} keeps the map open when a node is selected`,
    mobileMap?.containerEl.isShown() && node?.classList.contains('is-selected'),
    `view ${app.workspace.getMostRecentLeaf()?.getViewState().type}`,
  );
}

return { results };
