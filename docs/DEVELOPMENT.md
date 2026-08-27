# Development

## Commands

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
npm test       # the Vitest unit tests (npm run test:watch to watch)
npm run e2e    # the checks that need Obsidian itself; see below
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

A second plugin sits in the vault: **Write recorder**, which logs every write
to `.obsidian/plugins/mm-recorder/writes.log` - what changed, what is no longer
in the file, and the code that asked for it. It is how "a line disappeared"
stops being a guess. Nothing else depends on it; turn it off if it is in the way.

`Tabs.md` and `Crlf.md` are notes from elsewhere - tab indentation, and the line
endings Windows writes - which the checks edit to prove neither is disturbed.
`Fixtures.md` holds one of everything the parser and the map have
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
npm run e2e     # Fixtures.md open in a map and in an editing pane
```

The runner talks CDP over a WebSocket, which Node has as a global from 21 on:
on an older one it dies with `WebSocket is not defined`.

`harness.js` goes in front of whichever check runs - the map, the pane, and the
few ways of acting on either, so a check file is nothing but its cases. It waits
for conditions rather than on a clock. Each file below is a check, a line per
case:

- **`fidelity.js`** (the default) - every write against the file it should
  leave, character for character, and everything the map draws against what the
  file says. Run it twice, once with the pane editing and once in reading view,
  since the map writes through the editor in one and straight to the file in
  the other.
- **`keys.js`** (`npm run e2e test/e2e/keys.js`) - real keystrokes through
  Obsidian's keymap. It sees a key before the page does, so this is the only
  way to tell whether the map claims one that belonged to the editor open on
  top of it.
- **`root.js`** (`npm run e2e test/e2e/root.js`) - the note itself as a node:
  its own prose, and its folds.
- **`zoom.js`** (`npm run e2e test/e2e/zoom.js`) - header, cursor-anchored wheel
  and pinch zoom, centering, limits, and restoring one pane's zoom level.
- **`mobile.js`** (`npm run e2e test/e2e/mobile.js`) - opening and rendering a
  map in Obsidian's emulated mobile workspace.
- **`panes.js`** (`npm run e2e test/e2e/panes.js`) - a map follows the active
  file, and the linked-open command opens one tied to a note's tab instead. Only a real
  workspace has a second leaf to get this wrong with. It opens and closes panes
  of its own, and puts them back afterwards.
- **`popout.js`** (`npm run e2e test/e2e/popout.js`) - a note in a window of its
  own: which window the map lands in, and whether it drives the editor there
  rather than the one in the main window. It pops a window out and closes it
  again.

None of them are in CI. Checks start with Fixtures.md open in both views; the
mobile check instead starts after mobile emulation is enabled.

### Mobile layout and touch

In Developer Tools (`Cmd+Option+I` on macOS), run:

```js
this.app.emulateMobile(true);
```

Set a phone size in the device toolbar; restore with
`this.app.emulateMobile(false)`. This checks layout, not real multi-touch: test
pinch on a device. See Obsidian's
[mobile guide](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development).

A one-off goes the same way (`npm run e2e my-check.js`): a snippet evaluated in
the renderer, returning whatever you want printed. It reaches the map's DOM and
its measurements, every click, the editor's text and fold state, the plugin's
commands and settings, and a screenshot of the window. Two traps: read the text
back from the editor rather than the file, which lags it, and pick the node you
mean by its label - the first `.mindmap-collapse` in the DOM is rarely the one
you are thinking of.

### By hand

Only what a synthetic event cannot be: **an IME**, a **real drag**, and any
judgement about how it looks. In `Fixtures.md`:

- Edit a node's text with a Japanese IME - the Enter that confirms it does not
  close the editor, nothing lands in the file until the composition is, and the
  text comes out as composed
- Drag a node onto another - it becomes its child; drag to a sibling's edge - it
  lands there
- In mobile emulation, select a node - it stays selected on the visible map
  instead of replacing the map with its Markdown file
- Click `[[Linked]]` - map and editor both move to that note, and Obsidian's
  back button returns
- Turn `¶` on with the map beside a reading pane - selecting a line marks that
  line, and the pane does not scroll if the line is already on screen

## The demo gif

`docs/demo.gif` is a screen recording put through ffmpeg, which halves the file
size against a plain export. Record the map, then:

```bash
ffmpeg -i "Screen Recording.mov" -vf "fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 demo.gif
```

`stats_mode=diff` builds the palette from what moves rather than from the whole
frame, which is what keeps the nodes readable at 800px.

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
