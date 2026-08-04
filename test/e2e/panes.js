/**
 * A map follows the active file; the linked-open command opens one tied to a
 * note's tab, and the header button says so. Only a real workspace can answer
 * this: the whole question is which leaf "Open mind map" lands on, and what
 * the active file does to the maps already open.
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
const ours = view.leaf;

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
 * The command that asks for a map which keeps its note. Opening a pane ends by
 * focusing it, and anything that switches notes before that lands is taken
 * straight back, so wait for it.
 */
const openLinked = async () => {
  const before = maps().length;

  app.commands.executeCommandById('mindmap-editor:open-mindmap-linked');
  await until(() => maps().length > before);
  await settle();

  return maps().find((l) => l !== ours);
};

try {
  // A map on its own is the one that roams.
  {
    await activate(OTHER);
    check(
      'a map on its own follows the active file',
      !!(await until(() => ours.view.currentFile?.path === OTHER)),
      `it stayed on ${ours.view.currentFile?.path}`,
    );

    openMap();
    await settle();
    check(
      'a plain open reveals the map it already has, not a second one',
      maps().length === 1,
      `${maps().length} map panes open`,
    );
  }

  // A linked map: a second one, in the same tab group, tied to its note's tab.
  {
    const second = await openLinked();

    check(
      'the linked command opens a second map as a tab beside the first',
      !!second && second.parent === ours.parent,
      `${maps().length} map panes, same group ${second?.parent === ours.parent}`,
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
        ours.view.currentFile?.path === 'Fixtures.md',
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
    if (leaf !== ours) {
      leaf.detach();
    }
  }
  // A link left behind outlives this run: the next check's map would ignore
  // the active file, and its setup would fail for no reason it can name.
  ours.setGroup(null);
  await activate('Fixtures.md');
}

return { results };
