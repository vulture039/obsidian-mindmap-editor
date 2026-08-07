# CLAUDE.md

Obsidian plugin "Mindmap Editor": shows a Markdown note as an editable mind map and writes every map edit back
to the .md file.

## Design principles

- **Markdown text is the source of truth** - the map is a projection of the parse result, recomputed on every
  render; it has no storage format of its own.
- **Write ops validate line freshness** - each node keeps `line`/`endLine`; ops check `lineMatchesNode` and
  throw on mismatch → notice + re-render.
- **Nodes are HTML elements, edges are SVG** - checkboxes are real `<input>`s.
- **A setting is a default, a header button is this map's own** - `hideCompleted` and `showBodyText` start a
  map off; the pane then keeps its own in the view state. With maps side by side, one header must not redraw
  the others.
- **Three verbs, one job each** - **show/hide** is what one map draws (does it draw node text at all),
  **collapse/expand** is a branch (`−`/`+n`), **fold/unfold** is a node's own text (`≡`), which is the word
  Obsidian uses for the fold it mirrors.
- **The map draws a node's own text; the editor writes it** - a double-click on a line opens it there.

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

- **main.ts** - Plugin entry: view registration, commands, the note's own menu, settings, which leaf a new
  map lands on
- **core/** - No `obsidian` import, so it is unit-testable in plain Node: `parse/` Markdown in, `write/`
  Markdown out, `render/` where it goes on the canvas, and beside them `folds.ts` and `settings.ts`. One file
  is outside "unit-testable": `render/layout.ts` measures real offsetWidth/Height.
- **obsidian/** - Everything that touches the Obsidian API: `map/` is this plugin's own pane, `markdown/` is
  Obsidian's own seen from here - which pane to use, how a write reaches the file, and its fold state, which
  is non-public API throughout and feature-detected.
- **styles.css** - All styles
- **\*.test.ts** - Vitest. A test for one module sits beside it; one that crosses modules lives in **test/**:
  `write-ops`, `stale-edit`, and `inline-edit`, which runs the real editor under jsdom with
  `test/stubs/` standing in for what Obsidian adds to the DOM. What needs the API itself is driven over
  Obsidian's debugging port by **test/e2e/** (`npm run e2e`, app open): `harness.js` is the ground every check
  stands on, the files beside it are cases - `panes.js` and `popout.js` among them, since only a real
  workspace has the second leaf, and the second window, that pane resolution can get wrong.
  docs/DEVELOPMENT.md has both halves.

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
  There is nothing to confirm, so nothing is held back.
- **Node ops must survive a stale tree** - `lineMatchesNode` is the last check, after relocation, not instead.

### Writing to the file

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
  name reached the map and deleted the node under it. The editor's own keys come through a document
  capture listener gated on it holding the focus.
- **Enter must ignore IME composition** - a CJK IME's confirming Enter is a real keydown with `isComposing`.
- **Undo is the editor's** - every write goes through it, so `Mod+Z` on the map steps that same history. With no
  editing pane the write goes to the file and nothing remembers it, so the map keeps that one step itself.
- **Wikilinks navigate via `leaf.setViewState` + `result.history`** - it joins the leaf history, so Obsidian's
  own back/forward works; a custom mouse handler can be swallowed before the DOM ever sees it.
- **A map's tab is no place to open a note** - a search result clicked with the map in front took it. The leaf
  declines (`declineOpens`), not the view: `navigation` is also what the back/forward commands read.
- **What moves a map onto a file** - a linked tab if there is one, else the active file. Both are Obsidian's
  own, and there is nothing else: a follow setting and a private per-pane flag were each tried and each only
  added a second vocabulary for what "Link with tab" already says from the tab menu.
- **Opening a map is two requests through one gesture** - "show me this note's map" and "give me another
  pane". A map follows the active file, so asking for the map of the note in front of you can only mean the
  first, and the second needs to be asked for separately: a command and the `🔗` header button, which is where
  Obsidian's own Backlinks puts it ("open backlinks for the current note", link icon and all). A modifier would do the same
  job invisibly, and a shortcut nobody can see is a shortcut nobody uses. A menu on the note
  itself names the note, so what it opens is linked; only the ribbon and the plain command mean "the note I
  am on", which is the one that may roam.
- **A linked map goes beside its note, a roaming one beside the maps** - the pair is the point, so a linked map
  splits off its note's pane, and a map already split off that pane takes the next one as a tab: without that,
  switching a note's tab adds a column each time. A roaming map has no note to sit by, so it joins the maps
  already open. Only in that window, and only the map tied to the tab that asked - a map a window away is
  neither the one to sit beside nor the one you already have.

### A popout is a window of its own

- **Nothing global is the map's** - `document`, `CSS.highlights` and `setTimeout` all belong to one window, and
  a popout has its own of each. Reach them through the element at hand (`el.doc`, `el.win`), and where a
  listener has to hear every editor there is, put one on every window and on `window-open` too - a caret moves
  and a fold handle is clicked in the editor's document, not in ours.
- **The same note can be open in two windows** - so every pane lookup takes the pane it is asked from and
  prefers the nearest match: `file-io`'s `near`, which is the linked tab if there is one and the map's own leaf
  otherwise. Without it the first pane the workspace lists wins, and a map in a popout drives the editor in the
  main window.

### Drawing

- **Collapse handles are canvas elements, not node children** - placed after `applyPositions`, so they leave
  node widths to the text, and each stops its own pointerdown or the canvas starts a pan.
- **An edge starts past the collapse handle, and never past its own child** - the handle stands in the gap and
  hands out the far side of itself, so it reads as the joint; `EDGE_MIN_RUN` clamps that start, since the
  layout is free to shorten a gap below what the handle takes.
- **A level is read off the column it starts in, not off the node** - `columnsFor` gives every node of a level
  one left edge, from the widest node of the level before. Nothing drawn on the node replaces it: fill, size
  and border were each pushed as far as they go first, and ragged left edges still read as one flat thing.
- **The bend belongs at the parent's end** - a column is as wide as its widest node, so a narrow one's edge
  runs a long way, and that length has to go into a straight run. Both control points sit near the joint, so
  siblings part company at once. A shared trunk by the children was tried: the curves stay on one line to the
  last moment and, overdrawn in each child's color, come out in pieces. One cubic, no straight tail joined on
  - the join shows as a kink.
- **An edge's thickness is its arrival's, not its departure's** - `EDGE_WIDTHS` is indexed by the level the
  edge lands on and matched to that level's border. Siblings share a level, so the stub they leave by is that
  thickness too, and no edge changes width along itself.
- **A rung has to differ from its neighbour in every channel at once** - fill, outline, size. Whichever one
  two rungs share says nothing where it is needed, and one channel alone (a tint 8% lighter, a border half a
  pixel thinner) is invisible at a glance.
- **The ladder may never go back up** - a child drawn louder than its parent reads as a new start, so the rung
  is plain depth. Counting a heading by its heading level and a list by its indent was tried: a list item
  under an H3 restarted at the loudest rung, inside the node that held it. Past the last rung the two quietest
  take turns instead - equally quiet, the color carried by the fill or by the outline, so nothing goes up.
- **Opening an edit must not move the map** - the editor is styled like what it replaces, down to blank-line
  height and wrapping, and its buttons float over the node rather than taking a row.
- **hideCompleted removes checked nodes entirely** - they are absent from `laidByLine`, so selection and
  navigation walk visible nodes only.
- **Split direction: vertical = side by side, horizontal = stacked** - opposite of intuition; never use axis
  names in UI labels.
