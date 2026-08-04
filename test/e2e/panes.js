/**
 * A map follows the active file; Mod-click opens one linked to a note's tab,
 * which is what keeps it there. Only a real workspace can answer this: the
 * whole question is which leaf "Open mind map" lands on, and what the active
 * file does to the maps already open.
 *
 * Leaves the workspace as it found it - the extra panes are closed, whichever
 * case fails.
 */
const plugin = app.plugins.getPlugin('mindmap-editor');

if (!plugin) {
  return fail('the mindmap-editor plugin is not loaded');
}

const OTHER = 'Linked.md';
const other = app.vault.getAbstractFileByPath(OTHER);

if (!other) {
  return fail(`the dev vault has no ${OTHER}`);
}

const maps = () => app.workspace.getLeavesOfType('mindmap-editor');
const mapsFor = (path) =>
  maps().filter((leaf) => leaf.view.currentFile?.path === path);
const openMap = () =>
  app.commands.executeCommandById('mindmap-editor:open-mindmap');
/** The map pane the harness came in on, which is not ours to close. */
const kept = view.leaf;

/** Makes `path` the active file, the way the command reads it. */
const activate = async (path) => {
  const leaf =
    app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.file?.path === path) ?? app.workspace.getLeaf('tab');

  await leaf.openFile(app.vault.getAbstractFileByPath(path), { active: true });
  app.workspace.setActiveLeaf(leaf, { focus: true });

  return until(() => app.workspace.getActiveFile()?.path === path);
};

/**
 * The ribbon's Mod-click, which is what asks for a map that keeps its note.
 * Opening a pane ends by focusing it, and anything that switches notes before
 * that lands is taken straight back, so wait for it.
 */
const openLinked = async () => {
  const before = maps().length;
  const mac = navigator.platform.startsWith('Mac');

  document
    .querySelector('.side-dock-ribbon-action[aria-label*="mind map" i]')
    .dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        ctrlKey: !mac,
        metaKey: mac,
      }),
    );
  await until(() => maps().length > before);
  await settle();

  return maps().find((l) => l !== kept);
};

try {
  // A map on its own is the one that roams.
  {
    await activate(OTHER);
    check(
      'a map on its own follows the active file',
      !!(await until(() => kept.view.currentFile?.path === OTHER)),
      `it stayed on ${kept.view.currentFile?.path}`,
    );

    openMap();
    await settle();
    check(
      'a plain open reveals the map it already has, not a second one',
      maps().length === 1,
      `${maps().length} map panes open`,
    );
  }

  // Mod-click: a second map, in the same tab group, linked to the note's tab.
  {
    const second = await openLinked();

    check(
      'Mod-click opens a second map as a tab beside the first',
      !!second && second.parent === kept.parent,
      `${maps().length} map panes, same group ${second?.parent === kept.parent}`,
    );

    check(
      'and links it to the tab its note is in',
      !!second?.group &&
        app.workspace
          .getGroupLeaves(second.group)
          .some((l) => l.view.file?.path === OTHER),
      `group ${second?.group}`,
    );

    await activate('Fixtures.md');
    await settle();
    check(
      'the linked one keeps its note while the other follows',
      mapsFor(OTHER).length === 1 &&
        kept.view.currentFile?.path === 'Fixtures.md',
      `${maps()
        .map((l) => l.view.currentFile?.path)
        .join(', ')} after activating Fixtures.md`,
    );

    // Unlinking hands the pane back to the active file, as it does anywhere.
    second.setGroup(null);
    await activate(OTHER);
    await activate('Fixtures.md');
    check(
      'unlinking lets it follow again',
      !!(await until(() => second.view.currentFile?.path === 'Fixtures.md')),
      `it stayed on ${second.view.currentFile?.path}`,
    );
  }
} finally {
  for (const leaf of maps()) {
    if (leaf !== kept) {
      leaf.detach();
    }
  }
  await activate('Fixtures.md');
}

return { results };
