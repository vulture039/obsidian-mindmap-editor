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
  Headings are bold pills with a color-tinted fill; list items are plain pills.
- **Edit on the map** - Rename, add, delete, drag & drop. Dropping on a node's middle makes it a child;
  dropping near a sibling's top/bottom edge inserts it there.
- **Working checkboxes** - Clicking toggles `[ ]` ⇄ `[x]` in the file.
- **Collapse branches, in sync with the editor** - Every node with children gets a handle on the branch line at
  its right edge: `−` folds the branch away, `+3` brings it back (also in the right-click menu and on
  `Ctrl/Cmd + ←/→`). Folding a heading or list item in the Markdown pane collapses the same branch on the map,
  and collapsing on the map folds it in the editor - so a note folded down to its outline looks the same on
  both sides, and stays that way after a restart. A node with only text under it (a heading's paragraphs, a
  bullet's description) shows `≡` instead: it folds in the editor, where that text actually lives.
  Turn it off with **Sync collapse state with Markdown folding** to keep collapsing to the map only.
- **Collapse completed tasks** - The `✓✓` header button folds checked tasks into one `✓ n done` pill per parent.
  Click a pill to reveal just that parent (`− hide done` folds it back).
  Remembered across sessions.
- **Map and editor follow each other** - Selecting a node (by click or arrow keys) moves the Markdown editor's cursor to its line and briefly highlights it; moving the cursor in the editor selects the node that line belongs to and scrolls it into view. Neither side steals focus from the other.
- **Follow wikilinks** - Clicking a `[[wikilink]]` switches map and editor to the linked note together.
- **Branch colors** - Each top-level branch gets a palette color by position and its subtree inherits it.
  Customize the palette in settings, one hex color per line.

## Keyboard shortcuts

Active while the mind map pane is focused.

| Key                    | Action                                                               |
| ---------------------- | -------------------------------------------------------------------- |
| `↑` / `↓`              | Select previous / next sibling                                       |
| `←` / `→`              | Select parent / first child                                          |
| `Ctrl/Cmd + ←/→`       | Collapse / expand the selected branch (also in the right-click menu) |
| `Shift + ↑/↓`          | Move the node among its siblings (also in the right-click menu)      |
| `Enter`                | Add a sibling (a child on the root)                                  |
| `Tab`                  | Add a child                                                          |
| `F2`                   | Rename (same as double-click); `Enter` saves, `Esc` cancels          |
| `Space`                | Toggle the selected task's checkbox                                  |
| `Delete` / `Backspace` | Delete the node and its subtree                                      |
| `Esc`                  | Clear the selection                                                  |

Back/forward use Obsidian's own Navigate back / forward command:
`Ctrl + Alt + ←/→` (`Cmd + Option + ←/→` on macOS).

`Toggle focus between mind map and Markdown editor` can be bound to one in
Settings → Hotkeys to jump between the two.

The `⟳` header button, and the command `Refresh the mind map from the Markdown`,
rebuild the map from its file - the manual override for when the map and the
text look out of sync.

## Settings

**Settings → Mind map editor**:

- **Follow active file** (default on)
- **Hide completed tasks**
- **Sync collapse state with Markdown folding** (default on) - Needs the file open in an editor pane; whether a
  list item folds there also depends on Obsidian's own Editor → Fold settings.
- **Split direction** - Side by side / stacked; also updates itself when you rearrange the map pane.
- **Branch colors** - Custom palette, one hex color per line.

---

Building, testing and releasing the plugin: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
