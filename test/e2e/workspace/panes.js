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
const originalRememberLinkedMaps = plugin.settings.rememberLinkedMaps;
const originalCloseLinkedMapWithSource =
  plugin.settings.closeLinkedMapWithSource;

plugin.settings.autoOpenFiles = [];
plugin.settings.rememberLinkedMaps = false;
plugin.settings.closeLinkedMapWithSource = false;

const OTHER = 'E2E Panes.md';
const linkedFixture = app.vault.getAbstractFileByPath('Linked.md');

if (!linkedFixture) {
  return fail('the dev vault has no Linked.md');
}
const leftover = app.vault.getAbstractFileByPath(OTHER);

if (leftover) await app.vault.delete(leftover, true);
const other = await app.vault.create(
  OTHER,
  await app.vault.cachedRead(linkedFixture),
);

// Other maps in the developer's workspace are outside this check. The runner
// gives it one dedicated roaming map; count only that map and leaves made here.
const unrelatedMaps = new Set(
  app.workspace
    .getLeavesOfType('mindmap-editor')
    .filter((leaf) => leaf !== view.leaf),
);
const maps = () =>
  app.workspace
    .getLeavesOfType('mindmap-editor')
    .filter((leaf) => !unrelatedMaps.has(leaf));
const unrelatedMarkdown = new Set(
  app.workspace.getLeavesOfType('markdown').filter((leaf) => leaf !== md),
);
const mapsFor = (path) =>
  maps().filter((leaf) => leaf.view.currentFile?.path === path);
const markdownFor = (path) =>
  app.workspace
    .getLeavesOfType('markdown')
    .filter((leaf) => !unrelatedMarkdown.has(leaf))
    .find((leaf) => leaf.getViewState().state?.file === path);
const centered = (el, scroller) => {
  const box = el?.getBoundingClientRect();
  const port = scroller?.getBoundingClientRect();

  return (
    !!box &&
    !!port &&
    Math.abs(box.left + box.width / 2 - (port.left + port.width / 2)) < 1 &&
    Math.abs(box.top + box.height / 2 - (port.top + port.height / 2)) < 1
  );
};
const fits = (leaf) => {
  const scroller = leaf?.view.contentEl.querySelector('.mindmap-scroller');
  const canvas = leaf?.view.contentEl.querySelector('.mindmap-canvas');
  const zoom = leaf?.view.getState().zoom;

  return (
    !!scroller &&
    !!canvas &&
    typeof zoom === 'number' &&
    canvas.offsetWidth * zoom <= scroller.clientWidth - 63.9 &&
    canvas.offsetHeight * zoom <= scroller.clientHeight - 63.9
  );
};
const sameViewport = (actual, expected) =>
  actual &&
  expected &&
  Math.abs(actual.zoom - expected.zoom) < 0.001 &&
  Math.abs(actual.left - expected.left) < 1 &&
  Math.abs(actual.top - expected.top) < 1;
const closeMap = async (leaf) => {
  leaf?.detach();
  app.workspace.trigger('layout-change');
  await until(() => !leaf || !maps().includes(leaf));
};
const openMap = () =>
  app.commands.executeCommandById('mindmap-editor:open-mindmap');
/** The map pane the harness came in on, which is not ours to close. */
const ours = view.leaf;

/** Makes `path` the active file, the way the command reads it. */
const activate = async (path) => {
  const leaf =
    app.workspace
      .getLeavesOfType('markdown')
      .filter((candidate) => !unrelatedMarkdown.has(candidate))
      .find((candidate) => candidate.view.file?.path === path) ??
    app.workspace.createLeafBySplit(ours, 'vertical');

  await leaf.openFile(app.vault.getAbstractFileByPath(path), { active: true });
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await until(() => app.workspace.getActiveFile()?.path === path);

  return leaf;
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
  await settle();
  // A map on its own is the one that roams.
  {
    await activate(OTHER);
    check(
      'a map on its own follows the active file',
      !!(await until(() => ours.view.currentFile?.path === OTHER)),
      `it stayed on ${ours.view.currentFile?.path}`,
    );
    await app.workspace.revealLeaf(ours);
    await until(
      () =>
        ours.view.laidByLine.get(5)?.node.text === 'one' &&
        ours.view.revealTimer === null,
    );

    const roamingScroller =
      ours.view.contentEl.querySelector('.mindmap-scroller');

    roamingScroller.scrollLeft += 300;
    roamingScroller.scrollTop += 300;
    const roamingPosition = [
      roamingScroller.scrollLeft,
      roamingScroller.scrollTop,
    ];
    const source = markdownFor(OTHER);

    if (source) app.workspace.setActiveLeaf(source, { focus: true });
    openMap();
    await settle();
    check(
      'a plain open reveals the map it already has, not a second one',
      maps().length === 1,
      `${maps().length} map panes open`,
    );
    check(
      'revealing an existing map preserves its viewport',
      roamingScroller.scrollLeft === roamingPosition[0] &&
        roamingScroller.scrollTop === roamingPosition[1],
      `${roamingPosition.join(', ')} became ${roamingScroller.scrollLeft}, ${roamingScroller.scrollTop}`,
    );
  }

  // Reopening keeps the shared file viewport, regardless of its cursor target.
  {
    const source = markdownFor(OTHER);

    source?.view.editor?.setCursor({ line: 0, ch: 0 });
    if (source) app.workspace.setActiveLeaf(source, { focus: true });
    const expected = ours.view.viewport.snapshot();
    const fitted = await openLinked();

    check(
      'a root-body cursor does not replace the saved viewport',
      sameViewport(fitted?.view.viewport.snapshot(), expected),
      JSON.stringify(fitted?.view.viewport.snapshot()),
    );
    await closeMap(fitted);
  }

  // The title is outside the Markdown body. Its editor still remembers the
  // old body cursor, but opening from the title must not use that stale line.
  {
    const source = markdownFor(OTHER);

    source?.view.editor?.setCursor({ line: 5, ch: 0 });
    const title = source?.view.containerEl.querySelector('.inline-title');

    if (source) app.workspace.setActiveLeaf(source, { focus: true });
    title?.focus();
    const expected = ours.view.viewport.snapshot();
    const fitted = await openLinked();

    check(
      'opening from the note title retains the saved viewport',
      !!title && sameViewport(fitted?.view.viewport.snapshot(), expected),
      JSON.stringify(fitted?.view.viewport.snapshot()),
    );
    await closeMap(fitted);
  }

  // Reading View retains the editor's last meaningful body position.
  {
    const source = markdownFor(OTHER);

    source?.view.editor?.setCursor({ line: 5, ch: 0 });
    await source?.setViewState({
      type: 'markdown',
      active: true,
      state: { file: OTHER, mode: 'preview' },
    });
    if (source) app.workspace.setActiveLeaf(source, { focus: true });
    const expected = ours.view.viewport.snapshot();
    const readingMap = await openLinked();

    check(
      'Reading View retains the saved viewport',
      source?.view.getMode?.() === 'preview' &&
        sameViewport(readingMap?.view.viewport.snapshot(), expected),
      JSON.stringify(readingMap?.view.viewport.snapshot()),
    );
    await closeMap(readingMap);
    await source?.setViewState({
      type: 'markdown',
      active: true,
      state: { file: OTHER, mode: 'source' },
    });
  }

  // A linked map: a second one, in the same tab group, tied to its note's tab.
  {
    const source = markdownFor(OTHER);

    source?.view.editor?.setCursor({ line: 5, ch: 0 });
    if (source) app.workspace.setActiveLeaf(source, { focus: true });
    const expected = ours.view.viewport.snapshot();
    const second = await openLinked();
    const otherMarkdown = markdownFor(OTHER);

    check(
      "the linked command opens a second map outside its note's pane",
      !!second && second.parent !== otherMarkdown?.parent,
      `${maps().length} map panes, separate ${second?.parent !== otherMarkdown?.parent}`,
    );
    const scroller = second?.view.contentEl.querySelector('.mindmap-scroller');
    const canvas = second?.view.contentEl.querySelector('.mindmap-canvas');

    check(
      'a reopened map starts at its saved viewport',
      sameViewport(second?.view.viewport.snapshot(), expected),
      JSON.stringify(second?.view.viewport.snapshot()),
    );
    const fit = [
      ...(second?.view.containerEl.querySelectorAll('.view-action') ?? []),
    ].find(
      (button) =>
        button.getAttribute('aria-label') === 'Fit mind map to viewport',
    );

    click(fit);
    check(
      'the header Fit action fits and centers a newly opened map',
      !!fit && fits(second) && centered(canvas, scroller),
      `zoom ${second?.view.getState().zoom}`,
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
      'the Auto-open action visibly remembers the current note',
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
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
      if (leaf.getViewState().state?.file === 'Tabs.md') leaf.detach();
    }
    app.workspace.trigger('layout-change');
    await settle();
    const tabsSource = await activate('Tabs.md');
    const restoredTabs = await until(() =>
      mapsFor('Tabs.md').find(
        (map) =>
          map !== second &&
          map.group &&
          app.workspace.getGroupLeaves(map.group).includes(tabsSource),
      ),
    );
    check(
      'Auto-open restores a map linked to the note',
      !!restoredTabs,
      `${mapsFor('Tabs.md').length} maps show Tabs.md`,
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
    check(
      'closing its Markdown source leaves the Auto-opened map open',
      maps().includes(restoredTabs),
      `${maps().length} maps remain`,
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
      opened?.view.currentFile?.path === 'Tabs.md',
      `${maps()
        .map((l) => l.view.currentFile?.path)
        .join(', ')}`,
    );
  }
  // Remembering adds persistence to an explicit Link without coupling either
  // pane's lifetime or remembering files merely visited through that pane.
  {
    for (const leaf of maps()) {
      if (leaf !== ours) leaf.detach();
    }
    ours.setGroup(null);
    plugin.settings.autoOpenFiles = [];
    plugin.settings.rememberLinkedMaps = false;
    await plugin.saveSettings();

    const plainSource = await activate(OTHER);
    const plainLinked = await openLinked();

    plugin.settings.rememberLinkedMaps = true;
    await plugin.saveSettings();
    app.workspace.setActiveLeaf(plainSource, { focus: true });
    app.commands.executeCommandById('mindmap-editor:open-mindmap-linked');
    await until(() => plugin.settings.autoOpenFiles.includes(OTHER));
    check(
      'asking for an already linked map remembers it when enabled',
      plugin.settings.autoOpenFiles.includes(OTHER),
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );
    plugin.settings.autoOpenFiles = [];
    const plainScroller =
      plainLinked.view.contentEl.querySelector('.mindmap-scroller');
    const plainCanvas =
      plainLinked.view.contentEl.querySelector('.mindmap-canvas');

    plainSource.detach();
    app.workspace.trigger('layout-change');
    check(
      'closing a Link source leaves its map open without Auto-open',
      maps().includes(plainLinked) &&
        !plugin.settings.autoOpenFiles.includes(OTHER),
      `${maps().length} maps remain; remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );
    const centeredAfterClose = await until(() => {
      const left =
        plainCanvas.offsetLeft +
        (plainCanvas.offsetWidth * plainLinked.view.getState().zoom -
          plainScroller.clientWidth) /
          2;
      const top =
        plainCanvas.offsetTop +
        (plainCanvas.offsetHeight * plainLinked.view.getState().zoom -
          plainScroller.clientHeight) /
          2;

      return (
        Math.abs(plainScroller.scrollLeft - left) < 1 &&
        Math.abs(plainScroller.scrollTop - top) < 1
      );
    });

    check(
      'the surviving map recenters after its Markdown split closes',
      !!centeredAfterClose,
      `scroll ${plainScroller.scrollLeft}, ${plainScroller.scrollTop}`,
    );
    plainLinked.detach();

    plugin.settings.closeLinkedMapWithSource = true;
    await plugin.saveSettings();
    const closingSource = await activate(OTHER);
    const closingMap = await openLinked();

    closingSource.detach();
    app.workspace.trigger('layout-change');
    check(
      'the optional source-close setting closes the linked map',
      !!(await until(() => !maps().includes(closingMap))),
      `${maps().length} maps remain`,
    );
    plugin.settings.closeLinkedMapWithSource = false;

    plugin.settings.rememberLinkedMaps = true;
    await plugin.saveSettings();

    const source = await activate(OTHER);
    let linked = await openLinked();

    check(
      'an explicit Link remembers the note when the setting is on',
      plugin.settings.autoOpenFiles.includes(OTHER),
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );

    linked.detach();
    app.workspace.trigger('layout-change');
    check(
      'closing a linked map leaves its Markdown source open',
      app.workspace.getLeavesOfType('markdown').includes(source),
      `${app.workspace.getLeavesOfType('markdown').length} Markdown tabs remain`,
    );
    app.workspace.setActiveLeaf(source, { focus: true });
    linked = await openLinked();

    await source.openFile(app.vault.getAbstractFileByPath('Tabs.md'), {
      active: true,
    });
    app.workspace.setActiveLeaf(source, { focus: true });
    await until(() => linked.view.currentFile?.path === 'Tabs.md');
    check(
      'following a linked tab does not remember the visited note',
      !plugin.settings.autoOpenFiles.includes('Tabs.md'),
      `remembered ${plugin.settings.autoOpenFiles.join(', ')}`,
    );

    source.detach();
    app.workspace.trigger('layout-change');
    check(
      'closing a remembered Link source leaves its map open',
      maps().includes(linked),
      `${maps().length} maps remain`,
    );
    linked.detach();
    const restoredSource = await activate(OTHER);
    const restored = await until(() =>
      mapsFor(OTHER).find(
        (map) =>
          map !== ours &&
          map.group &&
          app.workspace.getGroupLeaves(map.group).includes(restoredSource),
      ),
    );
    check(
      'a remembered map reopens linked to its note',
      !!restored,
      `${mapsFor(OTHER).length} maps show ${OTHER}`,
    );

    restoredSource.detach();
    app.workspace.trigger('layout-change');
    check(
      'closing an Auto-open source leaves its restored map open',
      maps().includes(restored),
      `${maps().length} maps remain`,
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
  plugin.settings.rememberLinkedMaps = originalRememberLinkedMaps;
  plugin.settings.closeLinkedMapWithSource = originalCloseLinkedMapWithSource;
  await plugin.saveSettings();
  await activate('Fixtures.md');
  // Following is a render behind the active file, and the next check's setup
  // reads the map, not the workspace.
  await until(() => ours.view.currentFile?.path === 'Fixtures.md');
  await app.vault.delete(other, true);
}

return { results };
