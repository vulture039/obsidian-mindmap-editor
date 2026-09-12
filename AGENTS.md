# Repository instructions

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

## Code, comments, docs and names

- **Prefer array methods for array results and searches** - do not use `map` for side effects; keep a loop
  when mutation or control flow is clearer.
- **Keep conditional (`?:`) expressions short and on one line** - use a named value or `if`/`else` when a
  choice wraps or contains another choice.
- **Name a multi-clause condition when that clarifies the decision** - leave direct validation guards inline.
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
- **Always end with** `Co-Authored-By: <assistant> <model> <noreply@provider>`, naming the assistant and model
  that made the commit (e.g. `Codex GPT-5 <noreply@openai.com>` or `Claude Opus 4.8 <noreply@anthropic.com>`) —
  don't hardcode one assistant, model or provider.

## Layout

Two questions, in order. Does the file import the `obsidian` package -
`main.ts` → `obsidian/` → `core/`, one way. Then: which way is it facing.
`core/` reads Markdown, writes Markdown, or places what came out of it;
`obsidian/` faces this plugin's pane or Obsidian's own. Where a concern has a
part on each side, the two share a basename (`core/folds.ts` maps the ranges,
`obsidian/markdown/folds.ts` reads and writes them).

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
- **Use Obsidian's pane states** - a map follows its linked tab, or the active file when unlinked. Do not add a
  second follow or pin state; keep Link and Auto-open aligned with `docs/DEVELOPMENT.md`.
- **Auto-open and Link remain distinct** - following, unlinking, or closing a pane must not change Auto-open.
  Only explicit operations and the Remember linked maps setting connect them.
- **Place maps by intent** - linked maps sit beside their note, roaming maps beside maps in the same window,
  and mobile opens a tab. Reuse the matching pane rather than adding splits for repeated requests.

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

- **Collapse handles stay outside nodes** - place them after layout so they do not affect node width, and stop
  their pointerdown before the canvas starts panning. Edges begin beyond the handle, clamped by `EDGE_MIN_RUN`.
- **Depth alone sets the visual rung** - columns align each level; fill, outline, and size change together;
  children never look louder than parents. Beyond the last rung, alternate the two quietest styles.
- **Edges separate at the parent** - keep both cubic control points near the joint and use the arriving
  level's width throughout the edge.
- **Opening an edit must not move the map** - the editor is styled like what it replaces, down to blank-line
  height and wrapping, and its buttons float over the node rather than taking a row.
- **hideCompleted removes checked nodes entirely** - they are absent from `laidByLine`, so selection and
  navigation walk visible nodes only.
- **Split direction: vertical = side by side, horizontal = stacked** - opposite of intuition; never use axis
  names in UI labels.
