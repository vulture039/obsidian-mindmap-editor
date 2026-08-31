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
const originalAutoOpenFiles = [...plugin.settings.autoOpenFiles];

plugin.settings.autoOpenFiles = [];

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

    const roamingScroller =
      ours.view.contentEl.querySelector('.mindmap-scroller');

    roamingScroller.scrollLeft += 300;
    roamingScroller.scrollTop += 300;
    openMap();
    await settle();
    check(
      'a plain open reveals the map it already has, not a second one',
      maps().length === 1,
      `${maps().length} map panes open`,
    );
    const roamingCanvas = ours.view.contentEl.querySelector('.mindmap-canvas');
    const roamingLeft =
      roamingCanvas.offsetLeft +
      (roamingCanvas.offsetWidth * ours.view.getState().zoom -
        roamingScroller.clientWidth) /
        2;
    const roamingTop =
      roamingCanvas.offsetTop +
      (roamingCanvas.offsetHeight * ours.view.getState().zoom -
        roamingScroller.clientHeight) /
        2;

    check(
      'revealing an existing map centers it too',
      Math.abs(roamingScroller.scrollLeft - roamingLeft) < 1 &&
        Math.abs(roamingScroller.scrollTop - roamingTop) < 1,
      `scroll ${roamingScroller.scrollLeft}, ${roamingScroller.scrollTop}; center ${roamingLeft}, ${roamingTop}`,
    );
  }

  // A linked map: a second one, in the same tab group, tied to its note's tab.
  {
    const second = await openLinked();
    const otherMarkdown = app.workspace
      .getLeavesOfType('markdown')
      .find((leaf) => leaf.getViewState().state?.file === OTHER);

    check(
      "the linked command opens a second map outside its note's pane",
      !!second && second.parent !== otherMarkdown?.parent,
      `${maps().length} map panes, separate ${second?.parent !== otherMarkdown?.parent}`,
    );
    const scroller = second?.view.contentEl.querySelector('.mindmap-scroller');
    const canvas = second?.view.contentEl.querySelector('.mindmap-canvas');
    const centeredLeft =
      canvas?.offsetLeft +
      (canvas?.offsetWidth * second?.view.getState().zoom -
        scroller?.clientWidth) /
        2;
    const centeredTop =
      canvas?.offsetTop +
      (canvas?.offsetHeight * second?.view.getState().zoom -
        scroller?.clientHeight) /
        2;

    check(
      'a newly opened map starts in the center of its viewport',
      !!scroller &&
        Math.abs(scroller.scrollLeft - centeredLeft) < 1 &&
        Math.abs(scroller.scrollTop - centeredTop) < 1,
      `scroll ${scroller?.scrollLeft}, ${scroller?.scrollTop}; center ${centeredLeft}, ${centeredTop}`,
    );
    const beforeCenter = [scroller?.scrollLeft, scroller?.scrollTop];
    const center = [
      ...(second?.view.containerEl.querySelectorAll('.view-action') ?? []),
    ].find((button) => button.getAttribute('aria-label') === 'Center mind map');

    click(center);
    check(
      'pressing center immediately after opening does not move the map',
      scroller?.scrollLeft === beforeCenter[0] &&
        scroller?.scrollTop === beforeCenter[1],
      `${beforeCenter.join(', ')} became ${scroller?.scrollLeft}, ${scroller?.scrollTop}`,
    );

    // Asked again for the same note: the map tied to its tab, not another
    // pane. This is what keeps a workspace from filling up with maps.
    const was = maps().length;

    app.commands.executeCommandById('mindmap-editor:open-mindmap-linked');
    await settle();
    check(
      'asking again for that note opens no second pane',
      maps().length === was,
      `${was} map panes became ${maps().length}`,
    );

    check(
      'and links it to the tab its note is in',
      !!second?.group &&
        app.workspace
          .getGroupLeaves(second.group)
          .some((l) => l.view.file?.path === OTHER),
      `group ${second?.group}`,
    );

    check(
      'linking does not remember the note for automatic opening',
      plugin.settings.autoOpenFiles.length === 0,
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );
    const autoOpen = () =>
      [...second.view.containerEl.querySelectorAll('.view-action')].find(
        (button) =>
          /this map automatically with the note/.test(
            button.getAttribute('aria-label') ?? '',
          ),
      );

    click(autoOpen());
    await until(
      () =>
        plugin.settings.autoOpenFiles.includes(OTHER) &&
        autoOpen()?.classList.contains('is-active'),
    );
    check(
      'the bookmark action visibly remembers the current note',
      autoOpen()?.classList.contains('is-active') &&
        autoOpen()?.getAttribute('aria-label')?.startsWith('Stop'),
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );

    plugin.settings.autoOpenFiles = [OTHER, 'Tabs.md'];
    const linkedMapCount = maps().length;

    await otherMarkdown.openFile(app.vault.getAbstractFileByPath('Tabs.md'), {
      active: true,
    });
    app.workspace.setActiveLeaf(otherMarkdown, { focus: true });
    check(
      'a linked map follows its tab onto another remembered note',
      !!(await until(() => second?.view.currentFile?.path === 'Tabs.md')) &&
        maps().length === linkedMapCount,
      `it stayed on ${second?.view.currentFile?.path}; ${linkedMapCount} maps became ${maps().length}`,
    );
    await otherMarkdown.openFile(other, { active: true });
    app.workspace.setActiveLeaf(otherMarkdown, { focus: true });
    await until(() => second?.view.currentFile?.path === OTHER);

    const linkedGroup = second?.group;
    const mapCount = maps().length;

    await activate('Tabs.md');
    await settle();
    check(
      'auto-opening a remembered note reuses the active roaming map',
      ours.view.currentFile?.path === 'Tabs.md' &&
        !ours.group &&
        maps().length === mapCount,
      `${mapCount} maps became ${maps().length}; file ${ours.view.currentFile?.path}, group ${ours.group}`,
    );
    check(
      'auto-opening another note never takes over an existing linked map',
      !!linkedGroup && second?.group === linkedGroup,
      `group ${linkedGroup} became ${second?.group}`,
    );
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      if (leaf.getViewState().state?.file === 'Tabs.md') {
        app.workspace.setActiveLeaf(leaf, { focus: true });
        leaf.detach();
      }
    }
    app.workspace.trigger('layout-change');
    await settle();
    check(
      'closing an automatically opened note does not reopen it',
      !app.workspace
        .getLeavesOfType('markdown')
        .some((leaf) => leaf.getViewState().state?.file === 'Tabs.md'),
      `${app.workspace.getLeavesOfType('markdown').length} Markdown tabs remain`,
    );
    for (const leaf of mapsFor('Tabs.md')) {
      if (leaf === ours) {
        leaf.setGroup(null);
      } else {
        leaf.detach();
      }
    }

    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      if (leaf.getViewState().state?.file === 'Fixtures.md') leaf.detach();
    }
    app.workspace.trigger('layout-change');
    await settle();
    await activate('Fixtures.md');
    await settle();
    check(
      'the linked one keeps its note while the active file moves',
      second.view.currentFile?.path === OTHER,
      `${maps()
        .map((l) => l.view.currentFile?.path)
        .join(', ')} after activating Fixtures.md`,
    );

    // Unlinking hands the pane back to the active file, as it does anywhere.
    const unlink = [
      ...second.view.containerEl.querySelectorAll('.view-action'),
    ].find((button) => button.getAttribute('aria-label')?.startsWith('Unlink'));

    click(unlink);
    await until(() => !second.group);
    check(
      'unlinking leaves automatic-opening choices alone',
      plugin.settings.autoOpenFiles.includes(OTHER),
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );
    await activate(OTHER);
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      if (leaf.getViewState().state?.file === 'Fixtures.md') leaf.detach();
    }
    app.workspace.trigger('layout-change');
    await settle();
    await activate('Fixtures.md');
    check(
      'unlinking lets it follow again',
      !!(await until(() => second.view.currentFile?.path === 'Fixtures.md')),
      `it stayed on ${second.view.currentFile?.path}`,
    );
  }
  // A note's own menu names the note, so the map it opens is linked to it.
  {
    const items = [];
    const menu = {
      setSectionSubmenu: () => menu,
      addItem(build) {
        const item = {
          setTitle: (t) => ((item.title = t), item),
          setIcon: (i) => ((item.icon = i), item),
          setSection: () => item,
          onClick: (fn) => ((item.click = fn), item),
        };

        build(item);
        items.push(item);

        return menu;
      },
    };

    app.workspace.trigger(
      'file-menu',
      menu,
      app.vault.getAbstractFileByPath('Tabs.md'),
      'file-explorer',
    );
    const ours = items.find((i) => i.title?.startsWith('Open mind map'));

    ours?.click(new MouseEvent('click'));
    const opened = await until(() =>
      mapsFor('Tabs.md').find(
        (map) =>
          map.group &&
          app.workspace
            .getGroupLeaves(map.group)
            .some(
              (leaf) =>
                leaf.getViewState().type === 'markdown' &&
                leaf.getViewState().state?.file === 'Tabs.md',
            ),
      ),
    );

    await settle();
    check(
      "the note menu opens that note's map, linked to its tab",
      !!opened,
      `${items.length} items offered, group ${opened?.group ?? null}`,
    );

    await activate(OTHER);
    await settle();
    check(
      'and it stays there while the active file moves',
      mapsFor('Tabs.md').length === 1,
      `${maps()
        .map((l) => l.view.currentFile?.path)
        .join(', ')}`,
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
  plugin.settings.autoOpenFiles = originalAutoOpenFiles;
  await plugin.saveSettings();
  await activate('Fixtures.md');
  // Following is a render behind the active file, and the next check's setup
  // reads the map, not the workspace.
  await until(() => ours.view.currentFile?.path === 'Fixtures.md');
}

return { results };
