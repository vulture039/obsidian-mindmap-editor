# CLAUDE.md

Obsidian plugin "Mindmap Editor": shows a Markdown note as an editable mind map and writes every map edit back to the .md file.

## Design principles

- **Markdown text is the source of truth** - The map is a projection of the parse result,
  recomputed on every render; it has no storage format of its own.
- **Write ops validate line freshness** - Each node keeps `line`/`endLine`.
  Ops check `lineMatchesNode` before running and throw on mismatch → notice + re-render.
- **Nodes are HTML elements, edges are SVG** - Checkboxes are real `<input>`s.

## Comments

- **Say why, not what** - The code says what. A comment that restates it is noise.
- **One or two lines** - Trim to the load-bearing sentence. Needing a paragraph
  usually means the name or the split is wrong. Long-form context belongs in
  the Pitfalls section below, not in the file.

## Commit messages

- **Prefix the subject with a type** - `feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`
  (Conventional Commits).
  Formatting-only changes (comment reflow, whitespace) count as `chore:`, not a separate `style:` type.
- **Body only when it adds something** - Skip it when the subject already says
  it all. When a change needs a _why_ or a non-obvious note, add a short body
  (aim for a couple of lines, not a wall of text).
- **Always end with** `Co-Authored-By: Claude <model> <noreply@anthropic.com>`,
  naming the model that made the commit (e.g. `Claude Opus 4.8`) — don't hardcode one model.

## Layout

Split by the axis that matters here: whether a file imports the `obsidian`
package. Dependencies point one way: `main.ts` → `obsidian/` → `core/`. `core/`
imports nothing from `obsidian/`. Where a concern has both a pure part and an
Obsidian part, the two live under the same basename in each dir (e.g.
`core/settings.ts` holds the data, `obsidian/settings.ts` the settings tab;
`core/node-text.ts` parses links, `obsidian/node-text.ts` renders them).

- **main.ts** - Plugin entry: view registration, commands, settings, openSplit
- **core/** - No `obsidian` import, so it's unit-testable in plain Node:
  - **parser.ts** - Markdown → MindNode tree. lineMatchesNode
  - **patterns.ts** - Shared Markdown-structure regexes (heading/list/checkbox), so parser.ts and markdown-ops.ts agree on what each construct is
  - **markdown-ops.ts** - Pure line-editing ops (setText/setCheckbox/add/delete/move/reorder) over `string[]`
  - **node-text.ts** - Parses node text into link/plain segments (parseNodeText)
  - **folds.ts** - Maps Obsidian fold ranges ⇄ collapsed node lines (collapsedFromFolds/mergeFolds), and drops collapsed lines a re-parse invalidated
  - **settings.ts** - MindmapSettings shape and DEFAULT_SETTINGS
  - **render/** - The visual/spatial layer:
    - **colors.ts** - Per-branch colors, cycled by position from a user-configurable palette (settings)
    - **layout.ts** - Left-to-right tree layout (measures real DOM offsetWidth/Height, so DOM-bound and not unit-tested)
    - **drag.ts** - Pure drop-target resolution (canDrop/canDropAsSibling/findDrop); setupDrag's pointer handling stays in mindmap-view.ts
- **obsidian/** - Everything that touches the Obsidian API:
  - **mindmap-view.ts** - ItemView: rendering, selection, keyboard ops, inline edit, drag & drop, context menu, completed-task folding
  - **node-text.ts** - Renders the parsed segments to DOM links (wikilink / md link)
  - **file-io.ts** - Obsidian file I/O: findMarkdownView, updateFileLines (editor open → replaceRange, else vault.process)
  - **folds.ts** - Reads/writes the editor's fold state (`currentMode.get/applyFoldInfo`, `app.foldManager.load`), all of it non-public API and feature-detected
  - **settings.ts** - Settings tab (MindmapSettingTab)
- **styles.css** - All styles
- **\*.test.ts** - Vitest unit tests co-located under core/ (parser, markdown-ops, colors, drag, node-text). The obsidian/ modules need the Obsidian API, so no mock — they're exercised manually in a vault.

## Pitfalls (guards against past bugs)

- **Unmarked continuation lines under a list item extend its `endLine`** - A description paragraph indented
  under a bullet (no `-`/`*`/etc of its own) isn't a node, but must still move/delete with its item. The parser
  extends the innermost open list item's `endLine` to cover it; `fixLists` must start its rollup from the
  existing `endLine`, not reset to `n.line`, or the extension is silently discarded.
- **`renderSeq` serializes `render()`** - A render gone stale across an await must not touch the DOM. Concurrent
  renders cause double drawing and inconsistency.
- **Checkboxes write the DOM state, not a toggle** - `writeCheckbox` converges under rapid clicking.
- **Renders are deferred during `isInlineEditing`/`isDragging`** - Queued in `renderQueued`. Any path that sets
  these flags must guarantee they are cleared — a stuck flag kills all interaction. As a net, `isBusy()` checks
  each flag against the DOM its interaction owns (`.mindmap-edit-input`, `.is-dragging`) and clears one whose
  element is gone, so an edit that never got its blur or a drag that lost its pointerup can't freeze the map.
- **`startInlineEdit` re-resolves its element via `laidByLine`** - Aborts if focus can't be acquired. Esc is the
  forced-recovery failsafe.
- **The inline editor is a contenteditable span styled like the node** - Keeps dimensions unchanged.
  pointerdown/click/dblclick inside it must not bubble — bubbling triggers blur, which closes the editor.
- **hideCompleted removes checked nodes entirely** - They are absent from `laidByLine`; selection/navigation
  walk visible nodes only (`isHiddenDone`). Clicking "✓ n done" expands only that parent (`expandedDone`, keyed
  by the parent's line; cleared on file switch and on the global toggle).
- **Wikilinks navigate via `leaf.setViewState` + `result.history = true`** - This joins the leaf history, so
  Obsidian's native back/forward works (mouse buttons, tab-header arrows). No custom mouse-event handling — it
  can be swallowed at the OS/driver layer and never reach the DOM. `syncEditorTo` keeps the editor on the same
  file as the map.
- **`syncEditorTo` targets `lastActiveMarkdownLeaf`, not `getLeavesOfType[0]`** - `getLeavesOfType('markdown')`
  order has nothing to do with focus; indexing `[0]` can silently hijack an unrelated, unfocused tab elsewhere
  in the workspace. `active-leaf-change` tracks the last-focused Markdown leaf so wikilink follows land in the
  pane the user was actually looking at.
- **Editors can be empty right after startup** - A restored MarkdownView's editor may return "" before it loads.
  `getFileText` falls back to the vault; onLayoutReady re-renders.
- **Inline edit's Enter handler must ignore IME composition** - A Japanese/CJK IME's candidate-confirming Enter
  still fires a real `keydown` with `key === 'Enter'`, but `ev.isComposing` is true — treating it as "commit and
  exit" ends the edit mid-input. Guard on `isComposing` before acting, but keep `stopPropagation()` unconditional
  so the composing Enter can't leak to the view's global Enter shortcut either.
- **Fold sync has no event to hang on** - Obsidian fires nothing when the user folds a heading, so the view
  re-reads `getFoldInfo` after the interactions that can fold (document `click`/`keyup`, `active-leaf-change`)
  and compares `foldsKey`. That key is also set to whatever the map itself just wrote, so an echo of our own
  fold is not read back as a user action - to what the editor _took_, since Obsidian silently drops a fold it
  will not make (a list fold with Editor → Fold indent off). The editor leads: `render()` re-derives `collapsed` from the live
  folds, which is what keeps line-keyed collapse state correct across edits (Obsidian moves its folds with the
  text). Writing folds must save and restore the editor's scroll (`get/applyScroll`): `applyFoldInfo` unfolds
  everything and re-folds in a second transaction, and the editor creeps upward on every toggle otherwise. If
  writing ever fails, `foldSyncOff` stops _both_ directions — reading alone would let the next render undo
  every collapse made on the map.
- **Collapse handles are canvas elements, not node children** - Placed after `applyPositions` (their x needs the
  layout), so they leave node widths to the text. Each must stop its own pointerdown — reaching the canvas
  would start a pan. `drawEdges` takes a handle's right edge as that node's branch start (`outlets`) and spans
  the gap with a stub, so the handle reads as the joint the curves hang from instead of a badge beside them.
- **Split direction: vertical = side by side, horizontal = stacked** - Opposite of intuition — don't use axis
  names in UI labels. Auto-saved on layout-change from the DOM's mod-vertical/mod-horizontal classes (not
  overwritten when the map is the only pane).
