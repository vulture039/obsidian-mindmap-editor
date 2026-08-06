/**
 * A note in a window of its own. Everything global - the document a listener
 * goes on, the registry a highlight goes in, the pane a lookup finds first -
 * belongs to one window, and only a real popout can tell whether the map
 * reached for the right one.
 *
 * Leaves the workspace as it found it: the popout is closed, whichever case
 * fails.
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
/** The map pane the harness came in on, which is not ours to close. */
const ours = view.leaf;
const main = ours.getContainer();
/** A click has to come from the window it lands in, or it is not one. */
const clickIn = (target) =>
  target?.dispatchEvent(
    new target.win.MouseEvent('click', { bubbles: true, cancelable: true }),
  );

let popped = null;
let second = null;

try {
  // The note the user pulled out: its own window, and the map is asked for
  // from there.
  popped = app.workspace.getLeaf('tab');
  await popped.openFile(other, { active: true });
  app.workspace.moveLeafToPopout(popped);
  await until(() => popped.getContainer() !== main);
  app.workspace.setActiveLeaf(popped, { focus: true });
  await until(() => app.workspace.getActiveFile()?.path === OTHER);

  // The linked command, since a plain open would only reveal the roaming map
  // that followed the active file - a second map is what this is about.
  app.commands.executeCommandById('mindmap-editor:open-mindmap-linked');
  second = await until(() => maps().find((l) => l !== ours));
  await settle();

  check(
    "the map for a note in a popout opens in the note's own window",
    !!second && second.getContainer() === popped.getContainer(),
    second?.getContainer() === main ? 'it landed in the main window' : 'no map',
  );

  const map = second?.view;

  check(
    'and it shows that note',
    (await until(() => map?.currentFile?.path === OTHER)) !== null,
    `it is showing ${map?.currentFile?.path}`,
  );

  // Selecting a node moves the caret in the editor. Which editor is the whole
  // question: the note is open once, in the popout.
  const editor = popped.view.editor;
  const nodes = [
    ...map.contentEl.querySelectorAll('.mindmap-node[data-line]'),
  ].filter((el) => Number(el.dataset.line) > 0);
  const node = nodes[nodes.length - 1];
  const line = Number(node?.dataset.line);

  editor.setCursor({ line: 0, ch: 0 });
  clickIn(node?.querySelector('.mindmap-node-text') ?? node);
  check(
    'clicking a node in it moves the caret in the popout, not in the main window',
    !!node &&
      (await until(() => editor.getCursor().line === line)) !== null &&
      map.contentEl.querySelector('.mindmap-node.is-selected') === node,
    `asked for line ${line}, the editor is on ${editor.getCursor().line}`,
  );

  // The other direction: the caret moves in the popout's document, and only a
  // listener on that document hears it.
  const another = nodes.find((el) => Number(el.dataset.line) !== line);
  const back = Number(another?.dataset.line);

  popped.view.containerEl.win.focus();
  app.workspace.setActiveLeaf(popped, { focus: true });
  editor.setCursor({ line: back, ch: 0 });
  check(
    'and the caret moving in the popout selects the node on the map',
    !!another &&
      (await until(
        () =>
          map.contentEl.querySelector('.mindmap-node.is-selected') === another,
      )) !== null,
    `line ${back} is drawn, and the map marks ${
      map.contentEl.querySelector('.mindmap-node.is-selected')?.dataset.line
    }`,
  );

  // A reading pane takes the highlight the map paints itself, and that registry
  // is the window's own.
  await popped.setViewState({
    type: 'markdown',
    state: { file: OTHER, mode: 'preview' },
  });
  await until(() => popped.view.getMode() === 'preview');
  await settle();
  const body = [
    ...map.contentEl.querySelectorAll('.mindmap-node-body-line'),
  ][0];

  clickIn(body);
  const win = popped.view.containerEl.win;

  check(
    "the reading pane's line mark goes up in that window's registry",
    (await until(() => win.CSS.highlights.has('mindmap-line'))) !== null,
    win === window
      ? 'the pane never left the main window'
      : `main window: ${CSS.highlights.has('mindmap-line')}`,
  );
} finally {
  second?.detach();
  popped?.detach();
  await until(() => maps().length === 1);
}

return { results };
