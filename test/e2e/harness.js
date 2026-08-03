/**
 * What every check needs, put in front of it by run.mjs: the map and the pane
 * it is paired with, the file underneath them, and the few ways a check acts on
 * either. Nothing here is a case - the files beside it are all cases.
 *
 * Waiting is by condition, never by clock: the map renders when it renders, and
 * a check that slept long enough on one machine reports nonsense on another.
 */
const view = app.workspace.getLeavesOfType('mindmap-editor')[0]?.view;
const md = app.workspace
  .getLeavesOfType('markdown')
  .find((l) => l.view.file?.path === 'Fixtures.md');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const fail = (detail) => ({
  results: [{ name: 'setup', ok: false, detail }],
});

if (!view || !md) {
  return fail('open Fixtures.md in a Markdown pane and in a map');
}

if (view.file?.path !== 'Fixtures.md') {
  return fail(`the map is showing ${view.file?.path}, not Fixtures.md`);
}

// Obsidian hands a key to the view whose leaf is active; a check that presses
// one has to be sure that is the map.
const focusMap = () => app.workspace.setActiveLeaf(view.leaf, { focus: true });

focusMap();
const file = md.view.file;
const editor = md.view.editor;
const reading = md.view.getMode() !== 'source';
const el = view.contentEl;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** What `want` returns once it returns anything, or null once time is up. */
const until = async (want, ms = 2000) => {
  for (const end = Date.now() + ms; ;) {
    const got = await want();

    if (got) {
      return got;
    }
    if (Date.now() > end) {
      return null;
    }
    await wait(25);
  }
};

/** Long enough for a write that should not happen to have happened. */
const settle = () => wait(500);

// A reading pane's editor is not the file; an editing one is ahead of it.
const now = async () => (reading ? app.vault.read(file) : editor.getValue());
const drawn = async () => {
  const seq = view.renderSeq;

  await view.forceRefresh();
  await until(() => view.renderSeq !== seq && !view.renderQueued);
  await wait(60);
};
const editing = () => el.querySelector('.mindmap-edit-input');

/** Ends any edit left open: one holds off the renders every check waits on. */
const closeEditor = async () => {
  const input = editing();

  if (!input) {
    return;
  }
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await until(() => !editing());
};

const setFile = async (text) => {
  await closeEditor();
  focusMap();
  if (reading) {
    await app.vault.modify(file, text);
  } else {
    editor.setValue(text);
    await md.view.save();
  }
  await drawn();
};

const held = (input) => input.value ?? input.innerText;
/** Types into an editor the way a keyboard does: the file follows on its own. */
const type = (input, text) => {
  if (input.value === undefined) {
    input.textContent = text;
  } else {
    input.value = text;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const click = (target, how = 'click') =>
  target?.dispatchEvent(new MouseEvent(how, { bubbles: true }));
const key = (k, mods = {}) =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }),
  );
// A key the way the user presses it: through Obsidian's keymap, not just the
// page. run.mjs does the pressing; this waits for it to say it is done.
window.__waiting = new Map();
window.__pressed = (id) => {
  window.__waiting.get(id)?.();
  window.__waiting.delete(id);
};
let pressId = 0;
const press = (key, mods = {}) =>
  new Promise((resolve) => {
    const id = ++pressId;

    window.__waiting.set(id, resolve);
    window.__press(JSON.stringify({ id, key, mods }));
  });

const bodyLine = (starts) =>
  [...el.querySelectorAll('.mindmap-node-body-line')].find((n) =>
    n.textContent.trim().startsWith(starts),
  );
const label = (text) =>
  [...el.querySelectorAll('.mindmap-node-text')].find(
    (n) => n.textContent === text,
  );
const drawnAt = (line) =>
  el.querySelector(`.mindmap-node-body-line[data-line="${line}"]`);

/** Opens the editor on a line of a node's own text; null when none opened. */
const openBody = async (target) => {
  const line = typeof target === 'string' ? bodyLine(target) : target;

  click(line, 'dblclick');

  return until(() => editing());
};

/** Opens the editor on a node's label; null when none opened. */
const openLabel = async (text) => {
  const node = label(text);

  click(node);
  await wait(80);
  click(node, 'dblclick');

  return until(() => editing());
};

/** Waits for what was typed to reach the file, and the map to settle after it. */
const written = async (before) => {
  await until(async () => (await now()) !== before);
  await until(() => !view.renderQueued);
  await wait(60);
};

await drawn();
const original = await now();
const restore = () => setFile(original);
