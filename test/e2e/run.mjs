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
import { basename } from 'node:path';

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
  process.argv[2] ?? new URL('editing/fidelity.js', import.meta.url).pathname;
const isolatedWindow = basename(file) === 'panes.js';
// Mobile has only one visible leaf, so it cannot use the desktop harness's
// prerequisite of an open Markdown/map pair.
const harness =
  basename(file) === 'mobile.js'
    ? ''
    : readFileSync(new URL('support/harness.js', import.meta.url), 'utf8');
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
await send('Page.bringToFront');
await send('Emulation.setFocusEmulationEnabled', { enabled: true });

// Normalize one reusable fixture pair instead of accumulating a split per
// check. Unrelated panes in the developer's workspace are left alone.
if (basename(file) !== 'mobile.js') {
  await send('Runtime.evaluate', {
    expression: `(async () => {
      const path = 'Fixtures.md';
      const file = app.vault.getAbstractFileByPath(path);
      const plugin = app.plugins.getPlugin('mindmap-editor');
      const isolated = ${isolatedWindow};

      if (!file || !plugin) return;
      let md = isolated
        ? app.workspace.openPopoutLeaf({ size: { width: 1400, height: 900 } })
        : app.workspace
            .getLeavesOfType('markdown')
            .find((leaf) => leaf.view.file?.path === path);

      if (isolated) {
        await md.openFile(file);
      } else if (!md) {
        md = app.workspace.getLeaf('tab');
        await md.openFile(file);
      }
      await app.workspace.revealLeaf(md);
      let map = app.workspace
        .getLeavesOfType('mindmap-editor')
        .find(
          (leaf) =>
            leaf.view.currentFile?.path === path &&
            leaf.getContainer() === md.getContainer(),
        );

      map?.setGroup(null);
      await plugin.openMindmap(file, false, md);
      map = app.workspace
        .getLeavesOfType('mindmap-editor')
        .find(
          (leaf) =>
            leaf.view.currentFile?.path === path &&
            leaf.getContainer() === md.getContainer(),
        );
      if (!map) return;
      map.setGroup(null);
      await app.workspace.revealLeaf(map);
      window.__mindmapE2EFixture = { md, map };
    })()`,
    awaitPromise: true,
  });
}

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
    ${harness}
    ${readFileSync(file, 'utf8')}
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

// Put the reusable pair back on Fixtures without touching unrelated panes.
await send('Runtime.evaluate', {
  expression: `(async () => {
    const path = 'Fixtures.md';
    const file = app.vault.getAbstractFileByPath(path);
    const fixture = window.__mindmapE2EFixture;
    const isolated = ${isolatedWindow};

    if (isolated) {
      fixture?.map.detach();
      fixture?.md.detach();
    } else {
      fixture?.map.setGroup(null);
    }
    if (!isolated && file && fixture?.md) {
      await fixture.md.openFile(file);
      await app.workspace.revealLeaf(fixture.md);
    }
    for (let i = 0; !isolated && i < 40 && fixture?.map.view.currentFile?.path !== path; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    delete window.__mindmapE2EFixture;
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
