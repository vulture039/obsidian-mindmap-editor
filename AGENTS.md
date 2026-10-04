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

## Branches

- **Issue branches are named `feat/issue-<issue-no>`** - create or switch to that branch before changing code
  for an issue.

## Commit messages

- **Prefix the subject with a type** - `feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:` (Conventional
  Commits). Formatting-only changes count as `chore:`, not a separate `style:`.
- **Body only when it adds something** - a _why_ or a non-obvious note, in a couple of lines.
- **Always end with** `Co-Authored-By: <assistant> <model> <noreply@provider>`, naming the assistant and model
  that made the commit (e.g. `Codex GPT-5 <noreply@openai.com>` or `Claude Opus 4.8 <noreply@anthropic.com>`) —
  don't hardcode one assistant, model or provider.

## Layout

Dependencies flow one way: `main.ts` → `obsidian/` → `core/`. Put Markdown parsing, writing, and layout in
`core/`; put plugin-pane and Obsidian integration in `obsidian/`. Cross-layer concerns share a basename, such
as `core/folds.ts` and `obsidian/markdown/folds.ts`.

## Pitfalls (guards against past bugs)

Keep only cross-file rules and non-obvious failure modes here; local detail belongs beside the code.

### The map is a projection, and that has consequences

- **Defer renders while editing or dragging** - `renderQueued` holds them; `isBusy()` clears stale interaction
  flags whose DOM has disappeared.
- **Rendered line numbers may be stale** - every write first uses `core/relocate.ts`; ambiguous moved matches
  must be rejected rather than guessed.
- **An open edit reflows the map, it does not re-render it** - `applyLayout` re-measures what is on the canvas.
- **Map typing writes as it is typed** - debounce after keys and never write mid-IME.
- **Node ops must survive a stale tree** - `lineMatchesNode` is the last check, after relocation, not instead.

### Writing to the file

- **Unmarked continuation lines extend a list item's `endLine`** - `fixLists` rolls up from the existing
  `endLine`, not from `n.line`, or a description paragraph is left behind by a move or a delete.

### Folds

- **Branch and text folds are separate** - keep `collapsedBranches` and `foldedText` distinct. Resolve their
  lossy mapping to Obsidian folds only in `core/folds.ts` through `foldedKind`/`mergeFolds`.
- **Only fold range `from` is stable** - reading and editing panes report different `to` values, so
  `foldsKey` and `collapsedFromFolds` key on `from` alone.
- **A reading pane takes no fold state** - `applyFoldInfo` does nothing there, so `foldPreviewHeadings` clicks
  heading handles a pass at a time.
- **Fold sync has no event** - the view re-reads `getFoldInfo` after what can fold and compares `foldsKey`.
  That check may only re-render; adoption belongs in `render()` after re-parsing.
- **`lastEditorFoldsKey` records what the editor accepted** - read it back after a write because Obsidian may
  reject a requested fold.

### The keyboard and the editor are Obsidian's

- **Obsidian's keymap sees keys first** - register every map key through `onKey`; editor keys use a document
  capture listener gated on editor focus.
- **Enter must ignore IME composition** - a CJK IME's confirming Enter is a real keydown with `isComposing`.
- **Undo is the editor's** - every write goes through it, so `Mod+Z` on the map steps that same history. With no
  editing pane the write goes to the file and nothing remembers it, so the map keeps that one step itself.
- **Wikilinks navigate via `leaf.setViewState` + `result.history`** - it joins the leaf history, so Obsidian's
  own back/forward works.
- **A map leaf declines note opens** - set `declineOpens` on the leaf, not the view.
- **Use Obsidian's pane states** - a map follows its linked tab or, when unlinked, the active file. Do not add a
  second follow or pin state.
- **Auto-open and Link remain distinct** - following, unlinking, or closing a pane must not change Auto-open.
  Only explicit operations and the Remember linked maps setting connect them.
- **Place maps by intent** - linked maps sit beside their note, roaming maps beside same-window maps, and
  mobile opens a tab. Reuse a matching pane before adding a split.

### A popout is a window of its own

- **Nothing global belongs to every window** - use `el.doc`/`el.win` for `document`, `CSS.highlights`, and
  timers. Cross-editor listeners attach to every window and to `window-open`.
- **The same note may be open in two windows** - pane lookups take a nearby leaf and prefer the nearest match;
  use `file-io`'s `near` convention.

### Drawing

- **Collapse handles stay outside nodes** - place them after layout, stop pointerdown before canvas panning,
  and begin edges beyond them with `EDGE_MIN_RUN`.
- **Depth alone sets the visual rung** - columns align each level; fill, outline, and size change together;
  children never look louder than parents. Beyond the last rung, alternate the two quietest styles.
- **Edges separate at the parent** - keep both cubic control points near the joint and use the arriving
  level's width throughout the edge.
- **Opening an edit must not move the map** - match the replaced text's size and wrapping; float its buttons.
- **hideCompleted removes checked nodes entirely** - they are absent from `laidByLine`, so selection and
  navigation walk visible nodes only.
- **Split direction: vertical = side by side, horizontal = stacked** - opposite of intuition; never use axis
  names in UI labels.
