# Mind map editor

An Obsidian plugin that shows a note as a mind map you can edit directly.
The Markdown file is the source of truth: heading depth and list indentation
define the hierarchy, and every edit on the map is saved back as a plain
Markdown change.

## Usage

1. Open a Markdown file.
2. Run **Open mind map for the active file** (or click the ribbon icon).
3. The map opens in a split and stays in sync while you type.

## Features

- **Automatic mind map** from headings and bullet lists; the note title is
  the root. Headings are bold pills with a color-tinted fill, list items are
  plain pills.
- **Edit on the map**: rename, add, delete, drag & drop. Dropping on a
  node's middle makes it a child; dropping near a sibling's top/bottom edge
  inserts it there (an insertion bar appears and the sibling makes room).
- **Working checkboxes**: clicking toggles `[ ]` ⇄ `[x]` in the file.
- **Collapse completed tasks**: the check-check header button folds checked
  tasks into one `✓ n done` pill per parent. Click a pill to reveal just
  that parent (`− hide done` folds it back). Remembered across sessions.
- **Click to jump**: clicking a node moves the editor cursor to its line
  and briefly highlights it.
- **Follow wikilinks**: clicking a `[[wikilink]]` switches map and editor
  to the linked note together. The jump joins the tab's navigation history,
  so Obsidian's Navigate back/forward, the tab-header arrows, and the mouse
  back button all return.
- **Branch colors**: each top-level branch gets a palette color by position
  and its subtree inherits it. Pin colors in settings, one rule per line:
  `Project A: #3b82f6`.

## Keyboard shortcuts

Active while the mind map pane is focused (focus stays on the map after a
click-to-jump).

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select previous / next sibling |
| `←` / `→` | Select parent / first child |
| `Shift + ↑/↓` | Move the node among its siblings (also in the right-click menu) |
| `Enter` | Add a sibling (a child on the root) |
| `Tab` | Add a child |
| `F2` | Rename (same as double-click); `Enter` saves, `Esc` cancels |
| `Space` | Toggle the selected task's checkbox |
| `Delete` / `Backspace` | Delete the node and its subtree |
| `Esc` | Clear the selection |

Back/forward use Obsidian's own **Navigate back / forward** (macOS
`Cmd + Option + ←/→`, Windows/Linux `Ctrl + Alt + ←/→`, tab-header arrows,
or mouse back/forward buttons).

## Settings

**Settings → Mind map editor**: follow active file (default on), hide
completed tasks, split direction (side by side / stacked; also updates
itself when you rearrange the map pane), and branch color overrides.

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`<Vault>/.obsidian/plugins/mindmap-editor/` to test in a vault.
