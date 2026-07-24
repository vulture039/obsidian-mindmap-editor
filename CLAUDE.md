# CLAUDE.md

Obsidian plugin "Mindmap Editor": shows a Markdown note as an editable mind map and writes every map edit back to the .md file.

## Design principles

- **Markdown text is the source of truth** - The map is a projection of the parse result,
  recomputed on every render; it has no storage format of its own.
- **Write ops validate line freshness** - Each node keeps `line`/`endLine`.
  Ops check `lineMatchesNode` before running and throw on mismatch → notice + re-render.
- **Nodes are HTML elements, edges are SVG** - Checkboxes are real `<input>`s.

## Commit messages

- **Prefix the subject with a type** - `feat:`/`fix:`/`docs:`/`chore:`/`refactor:`/`test:`
  (Conventional Commits).
  Formatting-only changes (comment reflow, whitespace) count as `chore:`, not a separate `style:` type.

## Layout

- **main.ts** - Plugin entry: view registration, commands, settings, openSplit
- **mindmap-view.ts** - ItemView: rendering, selection, keyboard ops, inline edit, drag & drop, context menu, completed-task folding
- **parser.ts** - Markdown → MindNode tree. lineMatchesNode
- **patterns.ts** - Shared Markdown-structure regexes (heading/list/checkbox), so parser.ts and markdown-ops.ts agree on what each construct is
- **markdown-ops.ts** - Pure line-editing ops (setText/setCheckbox/add/delete/move/reorder) over `string[]`; no Obsidian import, so they're unit-testable
- **file-io.ts** - Obsidian file I/O: findMarkdownView, updateFileLines (editor open → replaceRange, else vault.process)
- **layout.ts** - Left-to-right tree layout (measures real DOM offsetWidth/Height)
- **drag.ts** - Pure drop-target resolution (canDrop/canDropAsSibling/findDrop); setupDrag's pointer handling stays in mindmap-view.ts
- **colors.ts** - Per-branch colors, cycled by position from a user-configurable palette (settings)
- **node-text.ts** - Node text rendering (wikilinks / md links become links)
- **settings.ts** - Settings tab
- **styles.css** - All styles
- **\*.test.ts** - Vitest unit tests, co-located with the pure-logic modules they cover (parser, markdown-ops, colors, drag). These modules import no Obsidian API, so no mock is needed; the Obsidian-facing view/file-io code is exercised manually in a vault instead.

## Pitfalls (guards against past bugs)

- **Unmarked continuation lines under a list item extend its `endLine`** - A description paragraph indented
  under a bullet (no `-`/`*`/etc of its own) isn't a node, but must still move/delete with its item. The parser
  extends the innermost open list item's `endLine` to cover it; `fixLists` must start its rollup from the
  existing `endLine`, not reset to `n.line`, or the extension is silently discarded.
- **`renderSeq` serializes `render()`** - A render gone stale across an await must not touch the DOM. Concurrent
  renders cause double drawing and inconsistency.
- **Checkboxes write the DOM state, not a toggle** - `writeCheckbox` converges under rapid clicking.
- **Renders are deferred during `isInlineEditing`/`isDragging`** - Queued in `renderQueued`. Any path that sets
  these flags must guarantee they are cleared — a stuck flag kills all interaction.
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
- **Split direction: vertical = side by side, horizontal = stacked** - Opposite of intuition — don't use axis
  names in UI labels. Auto-saved on layout-change from the DOM's mod-vertical/mod-horizontal classes (not
  overwritten when the map is the only pane).
