import { App, Keymap, TFile, WorkspaceLeaf } from 'obsidian';
import { findEditingView, findMarkdownView } from './file-io';
import {
  clearPreviewLine,
  markPreviewLine,
  PreviewBlock,
  keepPreviewScroll,
} from './preview-line';

/** What the map has to offer for its side of the conversation. */
export interface EditorPaneDeps {
  app: App;
  /** The map's own leaf, so its link group can be read. */
  leaf: WorkspaceLeaf;
  /** The file the map is showing, read on demand: it changes underneath. */
  file: () => TFile | null;
  /** A new pane in the user's configured direction, when there is none. */
  openSplit: () => WorkspaceLeaf;
  /** Whether the keyboard is on the map right now. */
  hasFocus: () => boolean;
  /** Hands the keyboard back to the map after a jump. */
  focusMap: () => void;
}

/**
 * The map's side of the Markdown pane: which pane to use, what to show in it,
 * and where to put its cursor. Every jump leaves focus where it found it
 * unless it is asked not to - the user is usually typing on the other side.
 */
export class EditorPane {
  private readonly deps: EditorPaneDeps;
  /**
   * Most recently focused Markdown leaf, so a new tab lands beside the editor
   * the user was actually looking at instead of an arbitrary open one.
   */
  private lastActive: WorkspaceLeaf | null = null;

  constructor(deps: EditorPaneDeps) {
    this.deps = deps;
  }

  /** Called on active-leaf-change; only Markdown leaves are of interest. */
  noteActiveLeaf(leaf: WorkspaceLeaf | null): void {
    if (leaf?.getViewState().type === 'markdown') {
      this.lastActive = leaf;
    }
  }

  /** The Markdown tab this map is linked to ("Link with tab"), if any. */
  linkedLeaf(): WorkspaceLeaf | null {
    // Read on demand: a cached copy would depend on when Obsidian assigns
    // the group.
    const group = (this.deps.leaf as WorkspaceLeaf & { group?: string }).group;

    if (!group) {
      return null;
    }
    for (const leaf of this.deps.app.workspace.getGroupLeaves(group)) {
      if (leaf !== this.deps.leaf && leaf.getViewState().type === 'markdown') {
        return leaf;
      }
    }

    return null;
  }

  /**
   * The linked tab's file, read from its view state so a tab that is still
   * deferred (never opened in this session) counts too.
   */
  linkedFile(): TFile | null {
    const path = this.linkedLeaf()?.getViewState().state?.file;
    const af =
      typeof path === 'string'
        ? this.deps.app.vault.getAbstractFileByPath(path)
        : null;

    return af instanceof TFile ? af : null;
  }

  /**
   * Where to show the map's file. The linked tab owns that job when there is
   * one; otherwise a new tab beside the Markdown pane the user was last
   * looking at (getLeavesOfType's order is unrelated to focus), since the
   * note that pane is showing is not ours to replace. No pane, so a split.
   */
  resolveLeaf(): WorkspaceLeaf {
    const linked = this.linkedLeaf();

    if (linked) {
      return linked;
    }
    const markdownLeaves = this.deps.app.workspace.getLeavesOfType('markdown');
    const near =
      (this.lastActive &&
        markdownLeaves.includes(this.lastActive) &&
        this.lastActive) ||
      markdownLeaves[0];

    return near
      ? this.deps.app.workspace.createLeafInParent(near.parent, -1)
      : this.deps.openSplit();
  }

  /** The Markdown tab holding `file`, opened beside the others if there is none. */
  async tabFor(file: TFile): Promise<WorkspaceLeaf> {
    const open = findMarkdownView(this.deps.app, file);

    if (open) {
      return open.leaf;
    }
    const leaf = this.resolveLeaf();

    await leaf.openFile(file, { active: false });

    return leaf;
  }

  /**
   * Shows `file` in a Markdown pane, so the editor tracks the file the map
   * shows. A tab that has it already is brought to the front rather than
   * replaced: the note in the pane beside the map is not ours to close.
   * True when a pane was actually moved - the caller may have focus to put
   * back, and doing that for nothing is what makes the map fight the user.
   */
  async showFile(file: TFile): Promise<boolean> {
    // The linked tab moves with the map even when another tab has the file.
    if (this.linkedLeaf()) {
      if (this.linkedFile()?.path === file.path) {
        return false;
      }
      await this.resolveLeaf().openFile(file, { active: false });

      return true;
    }
    const open = findMarkdownView(this.deps.app, file);

    if (open) {
      // Only a tab that is behind another one: revealing takes the focus.
      if (open.containerEl.isShown()) {
        return false;
      }
      await this.deps.app.workspace.revealLeaf(open.leaf);

      return true;
    }
    await this.resolveLeaf().openFile(file, { active: false });

    return true;
  }

  /**
   * Reveals and focuses the Markdown pane for the map's file, opening one if
   * none is open yet. The other half of the mind-map/Markdown toggle command
   * (see `openMindmap` in main.ts for the reverse direction).
   */
  async focus(): Promise<void> {
    const file = this.deps.file();

    if (!file) {
      return;
    }
    const existing = findMarkdownView(this.deps.app, file);
    const leaf = existing?.leaf ?? this.resolveLeaf();

    if (!existing) {
      await leaf.openFile(file, { active: false });
    }
    this.deps.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  /**
   * Moves the editor cursor to `line`, without stealing keyboard focus from
   * the map — selecting a node (click or arrow keys) always calls this, so the
   * map stays navigable throughout. `block` is what a reading pane renders the
   * line inside of, which is all such a pane can be pointed at.
   */
  async goToLine(line: number, block?: PreviewBlock): Promise<void> {
    const file = this.deps.file();

    if (!file || line < 0) {
      return;
    }
    // Only what the jump takes is given back. Focusing the map unasked makes
    // it the active leaf, and Obsidian then has no active file at all - the
    // note the user opens next goes nowhere.
    const had = this.deps.hasFocus();
    const mdView = findMarkdownView(this.deps.app, file);

    if (!mdView) {
      // resolveLeaf, not a fresh split: splitting past a Markdown tab that is
      // already there stacks up panes nobody asked for.
      await this.resolveLeaf().openFile(file, {
        active: false,
        eState: { line },
      });

      return;
    }
    const editor = mdView.editor;

    if (line > editor.lastLine()) {
      return;
    }
    const ch = editor.getLine(line).length;

    // The unfocused editor hides its caret, so flash-highlight the line (what
    // search results and outline clicks use). First: it places the caret at
    // the start of the line, and the caret belongs at the end.
    clearPreviewLine();
    const settle =
      mdView.getMode() === 'preview' ? keepPreviewScroll(mdView) : null;

    mdView.setEphemeralState({ line });
    if (settle) {
      if (block) {
        markPreviewLine(mdView, line, block);
      }
      settle();
    }
    editor.setCursor({ line, ch });
    editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch } }, true);
    if (had) {
      this.deps.focusMap();
    }
  }

  /**
   * Steps the editor's own history. Every write the map makes goes through
   * that editor, so this is where the map's edits are undone - there is no
   * second history to keep. False when no pane is open to hold one.
   */
  stepHistory(back: boolean): boolean {
    const file = this.deps.file();
    const view = file && findEditingView(this.deps.app, file);

    if (!view) {
      return false;
    }
    if (back) {
      view.editor.undo();
    } else {
      view.editor.redo();
    }

    return true;
  }

  /**
   * A double-click on body text means "let me edit this", so unlike every
   * other jump this one hands the keyboard over to the editor.
   */
  async editLine(line: number): Promise<void> {
    await this.goToLine(line);
    await this.focus();
  }

  /**
   * Opens a [[wikilink]]: hands the destination to `follow` (which moves the
   * map) and shows it in an editor pane. An unresolved link goes through
   * openLinkText first, which may create the note.
   */
  async openLink(
    target: string,
    evt: MouseEvent,
    follow: (dest: TFile) => Promise<void>,
  ): Promise<void> {
    const from = this.deps.file();

    if (!from) {
      return;
    }
    const linkpath = (target.split('#')[0] ?? '').trim();
    const resolve = (): TFile | null =>
      linkpath
        ? this.deps.app.metadataCache.getFirstLinkpathDest(linkpath, from.path)
        : null;
    const dest = resolve();

    if (dest?.extension === 'md') {
      await follow(dest);

      return;
    }
    // Unresolved or not Markdown: default behavior, then follow to the note
    // if one now exists.
    await this.deps.app.workspace.openLinkText(
      target,
      from.path,
      Keymap.isModEvent(evt),
    );
    const created = resolve();

    if (created?.extension === 'md') {
      await follow(created);
    }
  }
}
