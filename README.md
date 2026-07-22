# Mind map editor

An Obsidian plugin that shows a note as a mind map you can edit directly.
The Markdown file is the source of truth: heading depth and list indentation
define the hierarchy, and every edit on the map is saved back as a plain
Markdown change.

## Usage

1. Open a Markdown file.
2. Press Ctrl+P (Cmd+P on macOS) and run **Open mind map for the active file** (or click the ribbon icon).
3. The map opens in a split and stays in sync while you type.

## Features

- Automatic mind map  
  Headings and bullet lists become nodes, with the note title as the root.
  Headings are bold pills with a color-tinted fill; list items are plain
  pills.
- Edit on the map  
  Rename, add, delete, drag & drop. Dropping on a node's middle makes it a
  child; dropping near a sibling's top/bottom edge inserts it there.
- Working checkboxes  
  Clicking toggles `[ ]` ⇄ `[x]` in the file.
- Collapse completed tasks  
  The `✓✓` header button folds checked tasks into one `✓ n done`
  pill per parent. Click a pill to reveal just that parent (`− hide done`
  folds it back). Remembered across sessions.
- Click to jump  
  Clicking a node moves the editor cursor to its line and briefly
  highlights it.
- Follow wikilinks  
  Clicking a `[[wikilink]]` switches map and editor to the linked note
  together.
- Branch colors  
  Each top-level branch gets a palette color by position and its subtree
  inherits it. Customize the palette in settings, one hex color per line.

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

Back/forward use Obsidian's own **Navigate back / forward** command:  
`Ctrl + Alt + ←/→` (`Cmd + Option + ←/→` on macOS).

## Settings

**Settings → Mind map editor**:

- Follow active file (default on)
- Hide completed tasks
- Split direction  
  Side by side / stacked; also updates itself when you rearrange the map
  pane.
- Branch colors  
  Custom palette, one hex color per line.

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
```

To test the plugin in a vault, copy the following files into:

`<Vault>/.obsidian/plugins/mindmap-editor/`

- `main.js`
- `manifest.json`
- `styles.css`