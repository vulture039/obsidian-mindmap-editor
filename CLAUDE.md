# CLAUDE.md

Obsidian plugin "Mindmap Editor": shows a Markdown note as an editable
mind map and writes every map edit back to the .md file.

## Design principles
- Markdown text is the source of truth  
  The map is a projection of the parse result and has no storage format of
  its own. Heading depth + list indentation define the hierarchy.
- Write ops validate line freshness  
  Each node keeps `line`/`endLine`. Ops check `lineMatchesNode` before
  running and throw on mismatch → notice + re-render.
- Nodes are HTML elements, edges are SVG, checkboxes are real `<input>`s

## Layout
```
src/
  main.ts          Plugin entry: view registration, commands, settings, openSplit
  mindmap-view.ts  ItemView: rendering, selection, keyboard ops, inline edit,
                   drag & drop, context menu, completed-task folding
  parser.ts        Markdown → MindNode tree. lineMatchesNode, LIST_MARKER_SRC
                   (list-marker regex shared with ops)
  markdown-ops.ts  Mutation ops (setText/setCheckbox/add/delete/move/reorder),
                   updateFileLines (editor open → replaceRange, else vault.process)
  layout.ts        Left-to-right tree layout (measures real DOM offsetWidth/Height)
  colors.ts        Automatic per-branch colors + user overrides
  node-text.ts     Node text rendering (wikilinks / md links become links)
  settings.ts      Settings tab
styles.css         All styles
```

## Pitfalls (guards against past bugs)
- `renderSeq` serializes `render()`  
  A render gone stale across an await must not touch the DOM. Concurrent
  renders cause double drawing and inconsistency.
- Checkboxes write the DOM state, not a toggle  
  `writeCheckbox` converges under rapid clicking.
- Renders are deferred during `isInlineEditing`/`isDragging`  
  Queued in `renderQueued`. Any path that sets these flags must guarantee
  they are cleared — a stuck flag kills all interaction.
- `startInlineEdit` re-resolves its element via `laidByLine`  
  Aborts if focus can't be acquired. Esc is the forced-recovery failsafe.
- The inline editor is a contenteditable span styled like the node  
  Keeps dimensions unchanged. pointerdown/click/dblclick inside it must not
  bubble — bubbling triggers blur, which closes the editor.
- hideCompleted removes checked nodes entirely  
  They are absent from `laidByLine`; selection/navigation walk visible
  nodes only (`isHiddenDone`). Clicking "✓ n done" expands only that
  parent (`expandedDone`, keyed by the parent's line; cleared on file
  switch and on the global toggle).
- Wikilinks navigate via `leaf.setViewState` + `result.history = true`  
  This joins the leaf history, so Obsidian's native back/forward works
  (mouse buttons, tab-header arrows). No custom mouse-event handling — it
  can be swallowed at the OS/driver layer and never reach the DOM.
  `syncEditorTo` keeps the editor on the same file as the map.
- Editors can be empty right after startup  
  A restored MarkdownView's editor may return "" before it loads.
  `getFileText` falls back to the vault; onLayoutReady re-renders.
- Split direction: vertical = side by side, horizontal = stacked  
  Opposite of intuition — don't use axis names in UI labels. Auto-saved on
  layout-change from the DOM's mod-vertical/mod-horizontal classes (not
  overwritten when the map is the only pane).

## Verification
Ops logic runs standalone in Node.

Deploy: copy manifest.json, main.js, and styles.css into
`<vault>/.obsidian/plugins/mindmap-editor/`.
