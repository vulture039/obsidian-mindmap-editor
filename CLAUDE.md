# CLAUDE.md

Obsidian plugin "Mindmap Editor": shows a Markdown note as an editable mind map and writes every map edit back
to the .md file.

## Design principles

- **Markdown text is the source of truth** - the map is a projection of the parse result, recomputed on every
  render; it has no storage format of its own.
- **Write ops validate line freshness** - each node keeps `line`/`endLine`; ops check `lineMatchesNode` and
  throw on mismatch → notice + re-render.
- **Nodes are HTML elements, edges are SVG** - checkboxes are real `<input>`s.
- **Three verbs, one job each** - **show/hide** is the setting (does the map draw node text at all),
  **collapse/expand** is a branch (`−`/`+n`), **fold/unfold** is a node's own text (`≡`), which is the word
  Obsidian uses for the fold it mirrors.

## Comments, docs and names

- **Constants shout, enum members do not** - SCREAMING_SNAKE for a module
  constant, PascalCase for an enum member (the TypeScript handbook's own
  style): a member is already read through the enum's name.
- **Say why, not what** - the code says what; a comment that restates it is noise.
- **One or two lines** - needing a paragraph usually means the name or the split is wrong. Long-form context
  belongs in Pitfalls, not in the file.
- **README entries are one to three lines** - it is a feature list, not a manual.

## Commit messages

- **Prefix the subject with a type** - `feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:` (Conventional
  Commits). Formatting-only changes count as `chore:`, not a separate `style:`.
- **Body only when it adds something** - a _why_ or a non-obvious note, in a couple of lines.
- **Always end with** `Co-Authored-By: Claude <model> <noreply@anthropic.com>`, naming the model that made the
  commit (e.g. `Claude Opus 4.8`) — don't hardcode one model.

## Layout

Two questions, in order. Does the file import the `obsidian` package -
`main.ts` → `obsidian/` → `core/`, one way. Then: which way is it facing.
`core/` reads Markdown, writes Markdown, or places what came out of it;
`obsidian/` faces this plugin's pane or Obsidian's own. Where a concern has a
part on each side, the two share a basename (`core/folds.ts` maps the ranges,
`obsidian/markdown/folds.ts` reads and writes them).

- **main.ts** - Plugin entry: view registration, commands, settings, openSplit
- **core/** - No `obsidian` import, so it is unit-testable in plain Node:
  - **parse/** - Markdown in:
    - **parser.ts** - Markdown → MindNode tree; `body` is a node's own lines (its range minus every child's)
    - **patterns.ts** - The shared heading/list/checkbox regexes, so parse and write agree on each construct
    - **node-text.ts** - A node's own text → link/plain segments, for drawing
  - **write/** - Markdown out:
    - **ops.ts** - Every write the map can make, as a pure edit over `string[]`
    - **relocate.ts** - Finds a node or a run again in a fresh parse, by what it says and what it sits under
    - **edit-value.ts** - What typed text becomes before it goes back into the document
  - **render/** - Where it all goes on the canvas:
    - **colors.ts** - Per-branch colors, cycled by position from the palette setting
    - **layout.ts** - Left-to-right tree layout (measures real offsetWidth/Height, so not unit-tested)
    - **drag.ts** - Pure drop-target resolution
  - **folds.ts** - Obsidian's fold ranges ⇄ the map's two fold sets, and what each of them can fold
  - **settings.ts** - MindmapSettings shape and DEFAULT_SETTINGS
- **obsidian/** - Everything that touches the Obsidian API:
  - **map/** - This plugin's own pane:
    - **mindmap-view.ts** - ItemView: rendering, selection, keyboard, folds, context menu, file ops
    - **drag.ts** - The pointer handling, cues and ghost around core/render/drag's answers
    - **inline-edit.ts** - Renaming a node in place: keys, focus net, caret, and the write behind them
    - **node-text.ts** - Renders the parsed segments to DOM links
  - **markdown/** - Obsidian's own pane, seen from here:
    - **editor-pane.ts** - Which pane to use, what to show in it, where to put its cursor, its undo
    - **file-io.ts** - findMarkdownView, updateFileLines (editor open → replaceRange, else vault.process)
    - **folds.ts** - Reads/writes its fold state, all non-public API and feature-detected; a reading pane
      takes none, so its headings are folded by their own handles
    - **preview-line.ts** - A reading pane can only be pointed at a block; this narrows that to one line
  - **settings.ts** - Settings tab (MindmapSettingTab)
- **styles.css** - All styles
- **\*.test.ts** - Vitest. A test for one module sits beside it; one that crosses modules lives in **test/**:
  `body-edit`, `write-ops`, `stale-edit`, and `inline-edit`, which runs the real editor under jsdom with
  `test/stubs/` standing in for what Obsidian adds to the DOM. What needs the API itself is driven over
  Obsidian's debugging port by **test/e2e/** (`npm run e2e`, app open): `harness.js` is the ground every check
  stands on, the files beside it are cases - `panes.js` among them, since only a real workspace has the
  second leaf that pane resolution can get wrong. docs/DEVELOPMENT.md has both halves.

## Pitfalls (guards against past bugs)

Only what one file cannot say on its own: rules that span files, or that a
reader would have to reproduce a bug to learn. Anything a comment beside the
code already carries belongs there, not here.

### The map is a projection, and that has consequences

- **Renders are deferred while editing or dragging** - a rebuild would take the editor's element with it.
  `renderQueued` holds the render; `isBusy()` is the net, clearing a flag whose DOM is gone so a missing blur
  or pointerup cannot freeze the map.
- **So the map's line numbers are always from its last render** - and a render is debounced behind typing in
  the Markdown pane. Every write therefore goes through `core/relocate.ts` first: find the node (and the run)
  again in a parse of the lines being written, by what it says rather than where it was. Nothing is guessed -
  two matches with the lines moved is a refusal.
- **An open edit reflows the map, it does not re-render it** - `applyLayout` re-measures what is on the canvas.
- **What is typed on the map goes to the file as it is typed** - a debounce behind the keys, never mid-IME.
  There is nothing to confirm, so nothing is held back: the run the write aims at is found by what the last
  write left there, which keeps the two sides at most one debounce apart.
- **Node ops must survive a stale tree** - `lineMatchesNode` is the last check, after relocation, not instead.

### Writing to the file

- **A body edit may not change a line nobody touched** - `test/body-edit.test.ts` is the guard: opening and
  saving leaves the file byte for byte, deleting a line takes that line only, typing moves nothing outside the
  run. It caught trailing spaces (a hard line break in Markdown) being stripped, an indented blank line
  flattened, a deletion swallowing the blank beside it, and a run of blank lines erased by a save that typed
  nothing - the view compares against the value the editor _would hand back_, not the one it was given.
- **Body text is edited one run at a time** - a child between two stretches keeps them apart in the file, so
  `bodyRunOf` picks the run holding the clicked line. The indent is the one common to the whole body, which is
  what the parser stripped.
- **A refused write must not eat what was typed** - the ops check before they write (both write paths run the
  mutation before touching the file, so a throw means no partial write), and the view keeps the text in
  `pendingBodyEdit`, reopening the editor with it once the file and the node's own text still match.
- **Unmarked continuation lines extend a list item's `endLine`** - `fixLists` rolls up from the existing
  `endLine`, not from `n.line`, or a description paragraph is left behind by a move or a delete.

### Folds

- **Two folds, one of which the editor cannot hold** - `collapsedBranches` and `foldedText` are separate sets
  written by separate handles. Obsidian folds a line and everything under it, so `core/folds.ts` is where they
  meet it: a fold on a node with children is a branch fold, on one without them a text fold, and the text fold
  of a node that has children stays on the map. Keep that in `foldedKind`/`mergeFolds`; the view must not ask
  "does it have children" to place a fold.
- **Only `from` in a fold range can be trusted** - reading view puts a count where the editor puts an end line,
  so `foldsKey` and `collapsedFromFolds` both key on `from` alone. Measured on one file: the editor answers
  `47:65, 56:64` where reading view answers `47:48, 56:57` for the very same two folds.
- **A reading pane takes no fold state** - `applyFoldInfo` does nothing there, so `foldPreviewHeadings` clicks
  the handles its headings carry instead, a pass at a time: one that is folded away has not been rendered, so
  its own handle is not there to click until the one above it opens.
- **Fold sync has no event** - the view re-reads `getFoldInfo` after what can fold and compares `foldsKey`.
  That check may only re-render, never adopt: the editor moves its folds the moment an edit lands, while `root`
  is still the parse from before it. Adoption belongs in `render()`, right after the re-parse.
- **`lastEditorFoldsKey` holds what the editor has, not what we asked for** - read back after a write, so the
  map neither mistakes its own fold for the user's nor re-expands one Obsidian silently refused.

### The keyboard and the editor are Obsidian's

- **Obsidian's keymap sees a key before the page does** - so every key the map claims is registered through
  `onKey`, which hands it back while an editor is on the map. Without that, a Backspace typed into a node's
  own text reached the map and deleted the line under it. The editor's own keys come through a document
  capture listener gated on it holding the focus.
- **Enter must ignore IME composition** - a CJK IME's confirming Enter is a real keydown with `isComposing`.
- **A node's own text is edited in a `<textarea>`** - its value is the text, exactly. A contenteditable's is
  whatever the browser made of it: a typed break can come back as two newlines, and that reaches the file as a
  blank line nobody typed. The label keeps its span - one line has no break to get wrong.
- **Undo is the editor's** - every write goes through it, so `Mod+Z` on the map steps that same history. With no
  editing pane the write goes to the file and nothing remembers it, so the map keeps that one step itself.
- **Wikilinks navigate via `leaf.setViewState` + `result.history`** - it joins the leaf history, so Obsidian's
  own back/forward works; a custom mouse handler can be swallowed before the DOM ever sees it.
- **What moves a map onto a file** - a linked tab if there is one, else the active file. Both are Obsidian's
  own, and there is nothing else: a follow setting and a private per-pane flag were each tried and each only
  added a second vocabulary for what "Link with tab" already says from the tab menu.
- **Opening a map is two requests through one gesture** - "show me this note's map" and "give me another
  pane". A map follows the active file, so a plain click on the note in front of you can only mean the first,
  and there is nothing left to express the second. Obsidian never guesses between them: Mod-click is the
  second, everywhere in the app. It opens a tab beside the maps already there - splitting again would divide
  a pane that is half of one - and links it to its note's tab.

### Drawing

- **Collapse handles are canvas elements, not node children** - placed after `applyPositions`, so they leave
  node widths to the text, and each stops its own pointerdown or the canvas starts a pan.
- **Opening an edit must not move the map** - the editor is styled like what it replaces, down to blank-line
  height and wrapping, and its buttons float over the node rather than taking a row.
- **hideCompleted removes checked nodes entirely** - they are absent from `laidByLine`, so selection and
  navigation walk visible nodes only.
- **Split direction: vertical = side by side, horizontal = stacked** - opposite of intuition; never use axis
  names in UI labels.
