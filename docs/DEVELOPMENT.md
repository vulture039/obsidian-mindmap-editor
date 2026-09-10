# Development

## Commands

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint   # Obsidian's plugin and CSS review checks; warnings fail
npm run check  # all local build, lint, format, and unit checks
npm run release:check # same, after verifying Obsidian's ESLint is current
npm test       # the Vitest unit tests (npm run test:watch to watch)
npm run e2e    # the checks that need Obsidian itself; see below
```

## Map pane vocabulary

Keep these four behaviors separate:

| Term | Bound to | Behavior |
| --- | --- | --- |
| **Active** | The workspace | An unlinked map follows the active Markdown file. This is the normal map behavior. |
| **Link** | A desktop Markdown tab | The map follows that tab when it changes files. This is Obsidian's `Link with tab`; mobile falls back to a separate map tab. |
| **Auto-open** | A Markdown file | Opening it after its last Markdown tab closed ensures a linked map is visible; the active note is also checked at startup. Mobile opens a separate map tab. |
| **Pin** | A Markdown file | The map would stay on that file when tabs change. This is not currently implemented. |

Closing or unlinking a map does not disable Auto-open. Its header button can
always change this persistent choice; an explicit Link can also enable it when
**Remember linked maps** is on. Closing the Markdown tab does not reopen it;
Auto-open applies when a new Markdown tab for that file opens later.

**Remember linked maps** keeps the states distinct but connects their explicit
operations. Linking a map enables Auto-open for its current note, and enabling
Auto-open links the map to the note. Following a linked Markdown tab onto
another file never enables Auto-open for that file. Link does not couple pane
lifetimes by default: closing either pane leaves the other open. **Close linked
map with source** optionally closes the map when its Markdown source closes;
closing the map never closes Markdown.

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
npm run e2e     # with dev-vault open
```

The runner opens and normalizes the required unlinked `Fixtures.md` pane pair;
the vault only needs to be open. It runs the complete desktop suite by default;
pass one or more check files after `--` to narrow it. Unrelated panes are left
alone, and individual checks restore the files and settings they change.

The runner talks CDP over a WebSocket. The npm script enables Node 20's
experimental implementation; Node 21 and newer provide it by default.

`harness.js` goes in front of each check with the shared map, pane, and actions.
It waits for conditions rather than on a clock. `suite.mjs` is the canonical
list of desktop checks; each check describes its own scope at the top. These
checks are not run in CI. Mobile is excluded from the default suite and runs
separately after mobile emulation is enabled:

```bash
npm run e2e -- test/e2e/workspace/mobile.js
```

### Mobile layout and touch

In Developer Tools (`Cmd+Option+I` on macOS), run:

```js
this.app.emulateMobile(true);
```

Set a phone size in the device toolbar; restore with
`this.app.emulateMobile(false)`. This checks layout, not real multi-touch: test
pinch on a device. See Obsidian's
[mobile guide](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development).

A one-off goes the same way (`npm run e2e -- my-check.js`): a snippet evaluated in
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
- Ctrl/Cmd-click same-type siblings, then drag one - all selected subtrees move
  in their original order; Delete/Backspace removes all of them in one undo step
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

1. Merge the release changes into `master` and push them.
2. Run the
   [Obsidian Review branch scan](https://community.obsidian.md/account/plugins/mindmap-editor/review-branch)
   against `master` and resolve every warning.
3. Create and push the version commit and tag. `npm version` automatically runs
   `release:check` before it changes files or creates the tag.

```bash
npm version 1.0.1          # updates package/manifest/versions.json + commits + tags "1.0.1"
git push origin master     # push the version commit
git push origin 1.0.1      # push the tag → CI builds and drafts a release
```

- GitHub → Releases → open the "1.0.1" draft
- Write the description
- Click Publish release
- [Plugin page](https://community.obsidian.md/account/plugins/mindmap-editor) → click "Check for new releases"
