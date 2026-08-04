/**
 * Runs a check inside a running Obsidian, over the Electron debugging port.
 * Not part of `npm test`: it needs the app open on the dev vault, started with
 *   open -a Obsidian --args --remote-debugging-port=9222
 *
 *   node test/e2e/run.mjs [check.js]
 *
 * The file is evaluated in the renderer, behind harness.js, as the body of one
 * async function. It ends by returning `{ results }` - a case per entry, each
 * printed on its own line - and any case that did not pass fails the run.
 */
import { readFileSync } from 'node:fs';

/** What Chromium wants for the keys these checks press. */
const KEY_CODES = {
  Enter: 13,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  Tab: 9,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  ' ': 32,
};

const file =
  process.argv[2] ?? new URL('fidelity.js', import.meta.url).pathname;
const targets = await fetch('http://localhost:9222/json')
  .then((r) => r.json())
  .catch(() => null);

if (!targets) {
  console.error('No debugging port. Restart Obsidian with:');
  console.error('  open -a Obsidian --args --remote-debugging-port=9222');
  process.exit(1);
}

// By URL as well as title: a settings window carries the vault's name too,
// and it is an about:blank with no `app` on it.
const page = targets.find(
  (t) =>
    t.type === 'page' &&
    t.title.includes('dev-vault') &&
    t.url.startsWith('app://obsidian.md'),
);

if (!page) {
  console.error('No dev-vault window is open.');
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let id = 0;

const send = (method, params) =>
  new Promise((resolve) => {
    const n = ++id;

    pending.set(n, resolve);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);

  if (msg.id !== undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

// Real keystrokes, on request from the page. Obsidian's keymap sees a key
// before the page does, so a dispatched event never reaches it - and a check
// made of dispatched events cannot tell whether the map claims a key it should
// have left to the editor.
await send('Runtime.addBinding', { name: '__press' });
ws.addEventListener('message', async (e) => {
  const msg = JSON.parse(e.data);

  if (msg.method !== 'Runtime.bindingCalled' || msg.params.name !== '__press') {
    return;
  }
  const { id, key, mods = {} } = JSON.parse(msg.params.payload);
  const modifiers =
    (mods.altKey ? 1 : 0) |
    (mods.ctrlKey ? 2 : 0) |
    (mods.metaKey ? 4 : 0) |
    (mods.shiftKey ? 8 : 0);
  const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;

  await send('Input.dispatchKeyEvent', {
    type: text ? 'keyDown' : 'rawKeyDown',
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    text,
    unmodifiedText: text,
    modifiers,
    windowsVirtualKeyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0),
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
  await send('Runtime.evaluate', { expression: `window.__pressed(${id})` });
});

// The harness goes in front of every check: same map, same pane, same few
// ways of acting on them, so a check file is nothing but cases.
const res = await send('Runtime.evaluate', {
  expression: `(async () => {
    ${readFileSync(new URL('harness.js', import.meta.url), 'utf8')}
    ${readFileSync(file, 'utf8')}
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

// Every check asserts it starts on Fixtures.md, so every check has to leave it
// there - a run that moved the map (renaming the note, opening another one)
// would otherwise fail the next one for a reason it cannot name.
await send('Runtime.evaluate', {
  expression: `(async () => {
    const path = 'Fixtures.md';
    const md = app.workspace
      .getLeavesOfType('markdown')
      .find((l) => l.view.file?.path === path);

    if (!md) {
      return;
    }
    app.workspace.setActiveLeaf(md, { focus: true });
    const map = app.workspace.getLeavesOfType('mindmap-editor')[0];

    for (let i = 0; i < 40 && map?.view.currentFile?.path !== path; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  })()`,
  awaitPromise: true,
});

ws.close();
const thrown = res.result?.exceptionDetails;

if (thrown) {
  console.error(thrown.exception?.description ?? JSON.stringify(thrown));
  process.exit(1);
}

const value = res.result?.result?.value;
const results = value?.results;

if (!Array.isArray(results)) {
  console.log(JSON.stringify(value, null, 1));
  process.exit(1);
}

const failed = results.filter((r) => !r.ok);

for (const { name, ok, detail } of results) {
  console.log(
    `${ok ? '✓' : '✗'} ${name}${ok || !detail ? '' : ` - ${detail}`}`,
  );
}
console.log(
  `\n${results.length} cases, ${failed.length} failed${value.mode ? `, pane ${value.mode}` : ''}`,
);
process.exit(failed.length ? 1 : 0);
