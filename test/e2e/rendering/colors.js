/** Descendant variants change hue while the existing depth ladder stays intact. */
const plugin = app.plugins.getPlugin('mindmap-editor');
const originalPalette = plugin.settings.palette;
const wasShowingBody = view.showBodyText;
const wasHideCompleted = view.hideCompleted;
const wasFocusingTasks = view.focusIncompleteTasks;
const body = el.doc.body;
const wasDark = body.classList.contains('theme-dark');
const wasLight = body.classList.contains('theme-light');

try {
  plugin.settings.palette = '';
  await plugin.saveSettings();
  view.hideCompleted = false;
  view.focusIncompleteTasks = false;
  await drawn();
  if (!wasShowingBody) {
    view.showBodyText = true;
    await drawn();
  }
  const nodes = [...el.querySelectorAll('.mindmap-node[data-depth]')];
  const levelProperties = [
    '--level-fill',
    '--level-line',
    '--level-size',
    '--level-border',
    '--level-text',
  ];

  check(
    'neighbor colors use the master depth ladder without inline overrides',
    nodes.every((node) =>
      levelProperties.every(
        (property) => !node.style.getPropertyValue(property),
      ),
    ),
    `${nodes.filter((node) => levelProperties.some((property) => node.style.getPropertyValue(property))).length} nodes override the ladder`,
  );

  check(
    'neighbor colors are clean OKLCH colors, not nested mixes',
    nodes.every((node) =>
      node.style.getPropertyValue('--branch-color').startsWith('oklch('),
    ),
    `${nodes.filter((node) => !node.style.getPropertyValue('--branch-color').startsWith('oklch(')).length} nodes have another color form`,
  );

  const channel = (value) => {
    const normalized = value / 255;

    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const colorCanvas = new el.win.OffscreenCanvas(1, 1);
  const colorContext = colorCanvas.getContext('2d');
  const luminance = (color) => {
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const [red, green, blue] = colorContext.getImageData(0, 0, 1, 1).data;

    return (
      0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    );
  };
  const contrast = (foreground, background) => {
    const lighter = Math.max(luminance(foreground), luminance(background));
    const darker = Math.min(luminance(foreground), luminance(background));

    return (lighter + 0.05) / (darker + 0.05);
  };
  const bodyLines = [...el.querySelectorAll('.mindmap-node-body-line')];

  check(
    'theme contrast check includes visible body text',
    bodyLines.length > 0,
    'Fixtures.md rendered no body lines',
  );

  for (const theme of ['light', 'dark']) {
    body.classList.toggle('theme-light', theme === 'light');
    body.classList.toggle('theme-dark', theme === 'dark');
    await new Promise((resolve) => el.win.requestAnimationFrame(resolve));
    const coloredText = nodes.flatMap((node) => [
      node.querySelector('.mindmap-node-text') ?? node,
      ...node.querySelectorAll('.mindmap-node-body-line'),
    ]);
    const ratios = coloredText.map((text) => {
      const node = text.closest('.mindmap-node');
      const style = el.win.getComputedStyle(node);

      return contrast(
        el.win.getComputedStyle(text).color,
        style.backgroundColor,
      );
    });
    const minimum = Math.min(...ratios);
    const weakestText = coloredText[ratios.indexOf(minimum)];
    const weakest = weakestText.closest('.mindmap-node');
    const weakestStyle = el.win.getComputedStyle(weakest);

    check(
      `${theme} theme node text keeps AA contrast`,
      minimum >= 4.5,
      `minimum contrast ${minimum.toFixed(2)}:1 (${weakest.className}, ${weakest.style.getPropertyValue('--branch-color')}, ${el.win.getComputedStyle(weakestText).color} on ${weakestStyle.backgroundColor})`,
    );
    const done = nodes.find((node) => node.hasClass('is-done'));
    const doneText = done?.querySelector('.mindmap-node-text');

    check(
      `${theme} theme distinguishes completed tasks`,
      !!doneText &&
        el.win.getComputedStyle(doneText).textDecorationLine === 'line-through',
      doneText
        ? 'completed task is not visually muted'
        : 'no completed task rendered',
    );
  }

  plugin.settings.palette = '#ff0000\n#00ff00';
  await plugin.saveSettings();
  await drawn();
  const customNodes = [...el.querySelectorAll('.mindmap-node[data-depth]')];
  const firstFamily = customNodes.find((node) => node.dataset.depth === '0');
  const firstDescendant = customNodes.find(
    (node) =>
      node.dataset.depth === '1' &&
      node.style.getPropertyValue('--branch-color').includes('from #ff0000'),
  );

  check(
    'custom palette colors remain family bases',
    firstFamily?.style.getPropertyValue('--branch-color') === '#ff0000' &&
      !!firstDescendant &&
      el.win
        .getComputedStyle(firstDescendant)
        .getPropertyValue('--branch-color') !==
        el.win.getComputedStyle(firstFamily).getPropertyValue('--branch-color'),
    'the configured color or its descendant variant was not rendered',
  );
} finally {
  body.classList.toggle('theme-dark', wasDark);
  body.classList.toggle('theme-light', wasLight);
  plugin.settings.palette = originalPalette;
  await plugin.saveSettings();
  if (!wasShowingBody) {
    view.showBodyText = false;
  }
  view.hideCompleted = wasHideCompleted;
  view.focusIncompleteTasks = wasFocusingTasks;
  await drawn();
}

return { results, mode: reading ? 'reading' : 'editing' };
