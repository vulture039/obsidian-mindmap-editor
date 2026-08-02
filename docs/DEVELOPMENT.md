# Development

## Commands

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
npm test       # run the Vitest unit tests (npm run test:watch to watch)
```

## The dev vault

`dev-vault/` is an Obsidian vault kept in the repo. `npm run dev` builds
straight into `dev-vault/.obsidian/plugins/mindmap-editor/`, so there is
nothing to copy: open the folder as a vault once, and every save lands in it.

Set it up once:

1. Install [Hot Reload](https://github.com/pjeby/hot-reload) into the vault. It
   is a developer tool and is not in Obsidian's plugin browser, so clone it:

   ```bash
   git clone https://github.com/pjeby/hot-reload.git \
     dev-vault/.obsidian/plugins/hot-reload
   ```

   It reloads any plugin whose folder holds a `.hotreload` file (or a `.git`
   one) as soon as its `main.js` changes. Ours has the marker.

2. Obsidian → Open folder as vault → pick `dev-vault/`, and turn off Restricted
   mode. Both plugins are listed as enabled already, so there is nothing to
   switch on.

`npm run dev` then gives: save a `.ts` or `styles.css` → esbuild rebuilds →
Hot Reload reloads the plugin, no manual copying and no restart.

`Fixtures.md` in the vault holds one of everything the parser and the map have
to handle — nested lists, tasks, descriptions before and after a child, an
indented code block, a long unbroken URL, links, deep headings. Walk it top to
bottom for a manual pass instead of improvising. `Linked.md` is what its
wikilink points at, so following one can be seen going somewhere.

## Checking a change

`npm test` covers everything below the Obsidian API, including the whole write
path. What is left needs the app, and it splits in two.

### Driven from a terminal (no hands)

Obsidian is Electron, so it can be opened with a debugging port and driven over
CDP - enough to open a note, click a handle, measure an element and read the
editor back. Close Obsidian, then:

```bash
open -a Obsidian --args --remote-debugging-port=9222
```

A check is a snippet evaluated in the renderer; the pattern is always the same:

```js
const leaf = app.workspace.getLeavesOfType('mindmap-editor')[0];
const el = leaf.view.contentEl;                       // the map's DOM
const md = app.workspace.getLeavesOfType('markdown')
  .find((l) => l.view.file?.path === 'Fixtures.md');
const doc = () => md.view.editor.getValue();          // never vault.read: the
                                                      // file lags the editor
el.querySelector('.mindmap-node-body-line')
  .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
```

What that reaches: the map's DOM and its measurements (an element's size before
and after an edit opens), every click, the editor's text and fold state, the
plugin's commands and settings, and a screenshot of the window. Pick the node
you mean by its label - the first `.mindmap-collapse` in the DOM is rarely the
one you are thinking of.

### By hand

Only what a synthetic event cannot be: **real keystrokes** (`Mod + Enter` goes
through Obsidian's keymap, which ignores dispatched events), **an IME**, a
**real drag**, and any judgement about how it looks.

Walk `Fixtures.md` and check: the body editor takes text and `Mod + Enter`
saves it; a Japanese IME can compose in it without the first Enter closing it;
a node can be dragged onto another parent; `[[Linked]]` moves map and editor
together.

## Testing

Unit tests (Vitest) exercise the pure logic — Markdown parsing, the
line-editing operations, fold mapping, palette and drop-target rules. The
Obsidian-API-facing code is exercised by hand in the dev vault rather than
mocked.

## Issues

- Branch as `feat/issue-<issue-no>` and fix it there
- Open a pull request on GitHub and merge it
- Put `Closes #<issue-no>` in a commit message or in the PR description

## Release

```bash
npm version 1.0.1          # updates package/manifest/versions.json + commits + tags "1.0.1"
git push origin master     # push the commit
git push origin 1.0.1      # push the tag → CI builds and drafts a release
```

- GitHub → Releases → open the "1.0.1" draft
- Write the description
- Click Publish release
- [Plugin page](https://community.obsidian.md/account/plugins/mindmap-editor) → click "Check for new releases"
