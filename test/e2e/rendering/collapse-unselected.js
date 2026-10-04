/** The focus command keeps its selection visible and folds only other paths. */
await restore();
const fixture = [
  '# Other',
  '- child',
  ...Array.from({ length: 12 }, (_, i) => `  - unrelated ${i + 1}`),
  '# Active',
  '- sibling',
  '- Path',
  '  - Target',
].join('\n');

await setFile(fixture);
const target = label('Target')?.closest('.mindmap-node');

click(target);
await until(() => target?.hasClass('is-selected'));
target?.scrollIntoView({ block: 'center', inline: 'center' });
focusMap();
await app.commands.executeCommandById(
  'mindmap-editor:collapse-outside-selection',
);
await until(
  () =>
    !view.renderQueued &&
    !view.renderSnapshot &&
    view.collapsedBranches.has(0) &&
    view.collapsedBranches.has(1),
);
const selected = label('Target')?.closest('.mindmap-node');
const selectedBox = selected?.getBoundingClientRect();
const viewportBox = view.scrollerEl.getBoundingClientRect();
const visible =
  !!selectedBox &&
  selectedBox.left >= viewportBox.left &&
  selectedBox.right <= viewportBox.right &&
  selectedBox.top >= viewportBox.top &&
  selectedBox.bottom <= viewportBox.bottom;

check(
  'collapse-unselected keeps the selected path and hides unrelated children',
  !!selected?.hasClass('is-selected') &&
    !!label('Active') &&
    !!label('Path') &&
    !label('child') &&
    !label('unrelated 1'),
  el.querySelector('.mindmap-canvas')?.textContent,
);
check(
  'collapse-unselected keeps the selected node in the viewport',
  visible,
  JSON.stringify({ selected: selectedBox, viewport: viewportBox }),
);
check(
  'collapse-unselected does not change the Markdown',
  (await now()) === fixture,
  await now(),
);
const synced = await until(() => {
  if (!reading) {
    return md.view.currentMode
      .getFoldInfo?.()
      ?.folds.some((fold) => fold.from === 0);
  }
  const section = md.view.currentMode.renderer?.sections?.find(
    (entry) => entry.start?.line === 0,
  );

  return section?.el
    ?.querySelector('.heading-collapse-indicator')
    ?.hasClass('is-collapsed');
});

check(
  'collapse-unselected syncs its heading fold to Markdown',
  synced,
  JSON.stringify(md.view.currentMode.getFoldInfo?.()?.folds),
);

view.setAllCollapsed('branches', false);
await restore();

return { results };
