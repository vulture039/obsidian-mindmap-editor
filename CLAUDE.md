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

Split by whether a file imports the `obsidian` package. Dependencies point one way: `main.ts` → `obsidian/` →
`core/`. Where a concern has both a pure part and an Obsidian part, the two share a basename across the dirs
(`core/settings.ts` holds the data, `obsidian/settings.ts` the tab; `core/node-text.ts` parses links,
`obsidian/node-text.ts` renders them).

- **main.ts** - Plugin entry: view registration, commands, settings, openSplit
- **core/** - No `obsidian` import, so it's unit-testable in plain Node:
  - **parser.ts** - Markdown → MindNode tree; `body` is a node's own lines (its range minus every child's),
    each keeping its file line. lineMatchesNode answers whether a line still parses to a node
  - **patterns.ts** - Shared Markdown-structure regexes, so parser.ts and markdown-ops.ts agree on constructs
  - **markdown-ops.ts** - Pure line ops over `string[]` (setText/setBody/setCheckbox/add/delete/move/reorder)
  - **node-text.ts** - Splits node text into link/plain segments (parseNodeText)
  - **edit-value.ts** - What typed text becomes before it is written back (one line, or many)
  - **folds.ts** - Obsidian's fold ranges ⇄ the map's two fold sets (collapsedFromFolds/mergeFolds), what each
    can fold (branchTargets/textTargets), and pruning of lines a re-parse invalidated
  - **settings.ts** - MindmapSettings shape and DEFAULT_SETTINGS
  - **render/** - The visual/spatial layer:
    - **colors.ts** - Per-branch colors, cycled by position from the palette setting
    - **layout.ts** - Left-to-right tree layout (measures real offsetWidth/Height, so not unit-tested)
    - **drag.ts** - Pure drop-target resolution (canDrop/canDropAsSibling/findDrop)
- **obsidian/** - Everything that touches the Obsidian API:
  - **mindmap-view.ts** - ItemView: rendering, selection, keyboard ops, folds, context menu, file ops
  - **drag.ts** - The pointer handling, cues and ghost around core/render/drag's answers
  - **inline-edit.ts** - The contenteditable half of an edit: commit/cancel keys, focus net, caret placement
  - **editor-pane.ts** - The map's side of the Markdown pane: which pane to use (linked tab, last-focused, else
    a split), showing a file in it, and moving its cursor without taking focus
  - **node-text.ts** - Renders the parsed segments to DOM links (wikilink / md link)
  - **file-io.ts** - findMarkdownView, updateFileLines (editor open → replaceRange, else vault.process)
  - **folds.ts** - Reads/writes the editor's fold state, all non-public API and feature-detected
  - **settings.ts** - Settings tab (MindmapSettingTab)
- **styles.css** - All styles
- **\*.test.ts** - Vitest, co-located under core/. The obsidian/ modules need the Obsidian API and have no
  mock, so they are exercised by hand in a vault.

## Pitfalls (guards against past bugs)

### Parsing

- **Unmarked continuation lines extend a list item's `endLine`** - an indented description with no marker of its
  own is not a node but must move and delete with its item. `fixLists` rolls up from the existing `endLine`, not
  from `n.line`, or that extension is silently dropped.
- **Body text is collected per node, never for the root** - `collectBodies` runs after `computeEndLines`, so a
  heading's prose _after_ a sub-list counts as its own. The root is skipped: its range starts at line 0, which
  would pull frontmatter and loose top-level prose into the root node.
- **Only the indent common to every body line is stripped** - a block nested _inside_ a description survives the
  round trip, and `setBodyOp` re-applies that same indent. Trimming line by line would flatten the nesting on
  the first edit that touched any other line.

### Rendering

- **`renderSeq` serializes `render()`** - a render gone stale across an await must not touch the DOM, or nodes
  are drawn twice and `laidByLine` desyncs.
- **Renders are deferred while editing or dragging** - queued in `renderQueued`; a flag left set kills every
  interaction. `isBusy()` is the net: it clears a flag whose DOM is gone (`.mindmap-edit-input`,
  `.mindmap-node.is-dragging`), so a missing blur or pointerup cannot freeze the map.
- **An open inline edit reflows the map, it does not re-render it** - `applyLayout` re-measures and repositions
  what is on the canvas (handles and edges rebuilt, node elements not - the editor lives inside one).
- **Collapse handles are canvas elements, not node children** - placed after `applyPositions`, so they leave
  node widths to the text, and each stops its own pointerdown or the canvas starts a pan. `drawEdges` takes a
  branch handle's right edge as that node's outlet and spans the gap with a stub, so it reads as the joint the
  curves hang from.
- **Checkboxes write the DOM state, not a toggle** - `writeCheckbox` sends what the box shows, so rapid clicks
  before a re-render converge instead of alternating.
- **hideCompleted removes checked nodes entirely** - they are absent from `laidByLine`, so selection and
  navigation walk visible nodes only (`isHiddenDone`). A "✓ n done" node expands just its parent
  (`expandedDone`, cleared on file switch and on the global toggle).
- **Editors can be empty right after startup** - a restored MarkdownView may return "" before it loads;
  `getFileText` falls back to the vault and onLayoutReady re-renders.

### Editing

- **The inline editor is a contenteditable styled like what it replaces** - a span for the label, a block for
  body text, so the node keeps its size. pointerdown/click/dblclick inside it must not bubble; bubbling blurs
  it, which closes it. `runEditor` holds what both share, and only body text takes Enter for a line break, so
  it saves on Mod+Enter.
- **An edit that cannot take focus is aborted, not left open** - `startInlineEdit` re-resolves its element via
  `laidByLine` and never starts on a detached one; `runEditor` retries focus once, then gives up. Esc is the
  forced-recovery failsafe.
- **Enter must ignore IME composition** - a CJK IME's candidate-confirming Enter fires a real `keydown` with
  `isComposing` true; acting on it ends the edit mid-input. Guard on `isComposing`, but keep `stopPropagation`
  unconditional so that Enter cannot reach the view's own shortcut either.
- **Body text is edited one run at a time** - a child between two stretches of text keeps them apart in the
  file, so `bodyRunOf` picks the run holding the clicked line and `setBodyOp` splices only that. The indent is
  still the one common to the _whole_ body: that is what the parser stripped.
- **A refused body write must not eat what was typed** - `setBodyOp` checks every body line before writing
  anything (both write paths mutate before touching the file, so a throw means no partial write). The view
  keeps the text in `pendingBodyEdit` and reopens the editor with it after the re-render, but only if the file
  path _and_ the node's own text still match - a line number alone points at whatever moved into it. Otherwise
  the text goes to the clipboard. Esc is the only discard.

### Folds

- **Two folds, and only one of them fits in the editor** - `collapsedBranches` and `foldedText` are separate
  sets written by separate handles. Obsidian has one fold per line covering everything under it, so
  `core/folds.ts` is where they meet it: a fold on a node with children is a branch fold, on one without them a
  text fold, and the text fold of a node that _has_ children stays on the map. Keep that in
  `foldedKind`/`mergeFolds`; the view must never ask "does it have children" to place a fold.
- **The map only folds what it draws** - `≡` and the header's text button exist only while `showBodyText` is
  on. An editor fold on a node with no children is still read and written back either way.
- **Folded text is only visible through its own handle** - no ellipsis on the label (it reads as the text
  trailing off) and no stub row (it keeps the height the fold just saved), so `≡` stays pinned while folded and
  is hover-only otherwise - a second chip beside `−`/`+n` on every node with text is what that avoids.
- **Fold sync has no event to hang on** - nothing fires when the user folds a heading, so the view re-reads
  `getFoldInfo` after what can fold (document `click`/`keyup`, `active-leaf-change`) and compares `foldsKey`.
  That check may only re-render, never adopt: the editor moves its folds the moment an edit lands, while `root`
  is still the parse from before it. Adoption belongs in `render()`, right after the re-parse.
- **Only `from` in a fold range can be trusted** - reading view folds headings and lists of its own and reports
  them, but puts a count where the editor puts an end line (`{from: 7, to: 2}`). The map reads `from` alone, so
  `sanitize` squares up a `to` that cannot end the range instead of dropping the fold. Writes go to an editing
  pane only, whose ranges are real; reads prefer it and fall back to a reading one, so the map follows whatever
  pane the file is showing in.
- **"No editing pane" is not "the fold API is gone"** - `applyEditorFolds` says which it was, and only a real
  failure sets `foldSyncOff`, which stops the map following the editor as well.
- **`lastEditorFoldsKey` holds what the editor has, not what we asked for** - read back after a write, so the
  map neither mistakes its own fold for the user's nor re-expands a fold Obsidian silently refused. If writing
  fails outright, `foldSyncOff` stops _both_ directions; reading alone would undo every collapse made on the
  map. Writing also saves and restores the editor's scroll: `applyFoldInfo` unfolds and re-folds in two
  transactions, and the editor creeps upward otherwise.

### Workspace

- **Wikilinks navigate via `leaf.setViewState` + `result.history = true`** - this joins the leaf history, so
  Obsidian's own back/forward works. No custom mouse-event handling: it can be swallowed at the OS layer and
  never reach the DOM.
- **`EditorPane.resolveLeaf` targets the last-focused Markdown leaf** - `getLeavesOfType('markdown')` order has
  nothing to do with focus, and `[0]` can hijack an unrelated tab. `active-leaf-change` feeds `noteActiveLeaf`.
- **Split direction: vertical = side by side, horizontal = stacked** - opposite of intuition, so never use axis
  names in UI labels. Auto-saved from the DOM's mod-vertical/mod-horizontal classes, but not while the map is
  the only pane.
