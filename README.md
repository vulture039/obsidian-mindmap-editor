# Mind map editor

Edit your outline as a mind map, synced to Markdown.
No new file format, no markup to add.

![Demo: reordering and reparenting nodes by drag & drop, checking off a task, and renaming a node - all saved back to the Markdown file live](docs/demo.gif)

## Usage

1. Open a Markdown file.
2. Press Ctrl+P (Cmd+P on macOS) and run `Open mind map for the active file` (or click the ribbon icon).
3. The map opens in a split and stays in sync while you type.

## Features

- **Automatic mind map** - Headings and bullet lists become nodes, with the note title as the root;
  heading depth and list indentation define the hierarchy.
  Headings stand out by weight and a color-tinted fill; list items are plain.
- **Edit on the map** - Rename, add, delete, drag & drop. Dropping on a node's middle makes it a child;
  dropping near a sibling's top/bottom edge inserts it there.
- **Working checkboxes** - Clicking toggles `[ ]` ⇄ `[x]` in the file.
- **Collapse branches, in sync with the editor** - A handle on each node folds its branch (`−` / `+3`), and the
  Markdown pane folds with it - both ways, and after a restart. The header buttons and the fold commands do the
  whole map at once.
- **Show and edit a node's own text** - Off by default. The `¶` header button draws the lines under a node that
  are no node of their own inside it; `≡` on the node's corner folds that text on its own, apart from the
  branch, and that fold stays on the map (Obsidian folds a line and all it holds at once). Double-click a line
  to edit it right there: `Enter` makes a new line, `✓`/`✕` or `Mod + Enter`/`Esc` save and discard, and
  `Ctrl/Cmd + double-click` opens the line in the editor.
- **Hide completed tasks** - The `✓✓` header button hides checked tasks behind one `✓ n done` node per parent.
  Click it to reveal just that parent (`− hide done` puts them back).
  Remembered across sessions.
- **Map and editor follow each other** - Selecting a node (by click or arrow keys) moves the Markdown editor's cursor to its line and briefly highlights it; moving the cursor in the editor selects the node that line belongs to and scrolls it into view, down to the exact line when the node's text is drawn. Neither side steals focus from the other.
- **Follow wikilinks** - Clicking a `[[wikilink]]` switches map and editor to the linked note together.
- **Branch colors** - Each top-level branch gets a palette color by position and its subtree inherits it.
  Customize the palette in settings, one hex color per line.

## Keyboard shortcuts

Active while the mind map pane is focused.

| Key                    | Action                                                                |
| ---------------------- | --------------------------------------------------------------------- |
| `↑` / `↓`              | Select previous / next sibling                                        |
| `←` / `→`              | Select parent / first child                                           |
| `Ctrl/Cmd + ←/→`       | Collapse / expand the selected branch (also in the right-click menu)  |
| `Shift + ↑/↓`          | Move the node among its siblings, or the highlighted line of its text |
| `Enter`                | Add a sibling (a child on the root)                                   |
| `Tab`                  | Add a child                                                           |
| `F2`                   | Edit the highlighted line of text, else rename the node               |
| `Space`                | Toggle the selected task's checkbox                                   |
| `Delete` / `Backspace` | Delete the node and its subtree, or the highlighted line of its text  |
| `Mod + Z` / `Mod + ⇧Z` | Undo / redo, through the Markdown pane's own history                  |
| `Esc`                  | Clear the selection                                                   |

Back/forward use Obsidian's own Navigate back / forward command:
`Ctrl + Alt + ←/→` (`Cmd + Option + ←/→` on macOS).

## Commands

None of these come with a hotkey; bind the ones you want in Settings → Hotkeys.

| Command                                             | What it does                                          |
| --------------------------------------------------- | ----------------------------------------------------- |
| `Open mind map for the active file`                 | Same as the ribbon icon                               |
| `Toggle focus between mind map and Markdown editor` | Jumps between the two panes                           |
| `Collapse all branches` / `Expand all branches`     | The `⌄⌃` header button, one direction at a time       |
| `Fold all node text` / `Unfold all node text`       | The `≡` header button, likewise                       |
| `Show or hide node text on the map`                 | The `¶` header button                                 |
| `Refresh the mind map from the Markdown`            | The `⟳` header button: rebuilds the map from its file |

## Settings

**Settings → Mind map editor**:

- **Follow active file** (default on)
- **Hide completed tasks**
- **Sync collapse state with Markdown folding** (default on) - Needs an editor pane; list folding also follows
  Obsidian's Editor → Fold settings.
- **Show node text on the map** - Draw a node's own text inside the node; also the `¶` header button.
- **Split direction** - Side by side / stacked; also updates itself when you rearrange the map pane.
- **Branch colors** - Custom palette, one hex color per line.

---

Building, testing and releasing the plugin: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
