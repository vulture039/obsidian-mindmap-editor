import {
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from 'obsidian';
import { MindmapView, VIEW_TYPE_MINDMAP } from './obsidian/map/mindmap-view';
import { FoldKind } from './core/folds';
import { DEFAULT_SETTINGS, MindmapSettings } from './core/settings';
import {
  findMarkdownView,
  sameSplit,
  sameWindow,
} from './obsidian/markdown/file-io';
import { MindmapSettingTab } from './obsidian/settings';
import { AutoOpenMaps } from './obsidian/map/auto-open';

export default class MindmapPlugin extends Plugin {
  settings!: MindmapSettings;
  private autoOpen!: AutoOpenMaps;
  /**
   * The note a map is pointing the Markdown side at right now. Showing it
   * makes it the active file, and the roaming map would follow it there -
   * clicking a map would drag every other one onto the same note. By path
   * rather than a flag: a note the user opens meanwhile is still theirs.
   */
  mapDrivenOpen: string | null = null;

  /** True on a device and while Obsidian's desktop mobile emulator is on. */
  get isMobile(): boolean {
    return (
      Platform.isMobile ||
      (this.app as typeof this.app & { isMobile?: boolean }).isMobile === true
    );
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    this.autoOpen = new AutoOpenMaps(this, (file) => {
      void this.openMindmap(file, true);
    });
    this.registerView(
      VIEW_TYPE_MINDMAP,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this),
    );
    this.addRibbonIcon('git-fork', 'Open mind map', () => {
      void this.openMindmap();
    });
    this.addCommand({
      id: 'open-mindmap',
      name: 'Open mind map for the active file',
      callback: () => {
        void this.openMindmap();
      },
    });
    this.addCommand({
      id: 'open-mindmap-linked',
      name: 'Open mind map linked to the active file',
      callback: () => {
        void this.openMindmap(undefined, true);
      },
    });
    this.addCommand({
      id: 'toggle-map-focus',
      name: 'Toggle focus between mind map and Markdown editor',
      callback: () => {
        void this.toggleMindmapFocus();
      },
    });
    this.addCommand({
      id: 'refresh-mindmap',
      name: 'Refresh the mind map from the Markdown',
      callback: () => {
        this.withMindmap((view) => void view.forceRefresh());
      },
    });
    this.addCommand({
      id: 'fit-mindmap',
      name: 'Fit mind map to viewport',
      callback: () => {
        this.withMindmap((view) => view.fit());
      },
    });
    this.addCommand({
      id: 'toggle-node-text',
      name: 'Show or hide node text on the map',
      callback: () => {
        this.withMindmap((view) => view.toggleBodyText());
      },
    });
    this.addFoldCommands();
    this.addFileMenuItem();
    this.autoOpen.register();
    this.addSettingTab(new MindmapSettingTab(this.app, this));
  }

  /** Whether this note explicitly asks for its map when it next opens. */
  isAutoOpenFile(file: TFile | null): boolean {
    return this.autoOpen.isRemembered(file);
  }

  async toggleAutoOpen(file: TFile | null): Promise<void> {
    await this.autoOpen.toggle(file);
  }

  /** Optionally make an explicit Link persistent for this note. */
  async rememberLinkedMap(file: TFile): Promise<void> {
    if (this.settings.rememberLinkedMaps) {
      await this.autoOpen.remember(file);
    }
  }

  /**
   * A note's own menu - the file explorer, a tab header, a link. It names the
   * note, so the map it opens is linked to it: one that followed the active
   * file would leave the note you just picked the moment you opened another.
   * The title says so, since the menu is where the user finds out.
   */
  private addFileMenuItem(): void {
    this.registerEvent(
      // The leaf the menu was opened on: a right-click leaves the active
      // pane where it was, so the window it names cannot be found afterwards.
      this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
        if (!(file instanceof TFile) || file.extension !== 'md') {
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle('Open mind map linked to this note')
            .setIcon('git-fork')
            .onClick(() => void this.openMindmap(file, true, leaf)),
        );
      }),
    );
  }

  /**
   * The header's bulk fold buttons as commands, so they can take a hotkey.
   * Explicit directions, not the buttons' toggle: a hotkey that folds only
   * every other press is not one you can hold down.
   */
  private addFoldCommands(): void {
    const commands: [
      id: string,
      name: string,
      kind: FoldKind,
      fold: boolean,
    ][] = [
      ['collapse-all', 'Collapse all branches', FoldKind.Branches, true],
      ['expand-all', 'Expand all branches', FoldKind.Branches, false],
      ['fold-all-text', 'Fold all node text', FoldKind.Text, true],
      ['unfold-all-text', 'Unfold all node text', FoldKind.Text, false],
    ];

    for (const [id, name, kind, fold] of commands) {
      this.addCommand({
        id,
        name,
        callback: () => {
          this.withMindmap((view) => view.setAllCollapsed(kind, fold));
        },
      });
    }
  }

  /** Every open mind map, in workspace order. */
  private mindmapViews(): MindmapView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE_MINDMAP)
      .map((leaf) => leaf.view)
      .filter((view): view is MindmapView => view instanceof MindmapView);
  }

  /** Every open map as a pane, deferred tabs included. */
  private mapLeaves(): WorkspaceLeaf[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP);
  }

  /**
   * The note a map pane shows, off its view state: a tab not opened since the
   * app started has no view of ours yet, and is still a map that is open.
   */
  private mapFile(leaf: WorkspaceLeaf): string | null {
    const path = leaf.getViewState().state?.file;

    return typeof path === 'string' ? path : null;
  }

  /**
   * Whether a map pane is tied to `tab`, by the leaf group "Link with tab"
   * puts them in - `EditorPane.linkedLeaf`, asked of a pane with no view yet.
   */
  private tiedTo(leaf: WorkspaceLeaf, tab: WorkspaceLeaf): boolean {
    const group = (leaf as WorkspaceLeaf & { group?: string }).group;

    return (
      !!group && group === (tab as WorkspaceLeaf & { group?: string }).group
    );
  }

  /**
   * Runs `run` on the focused mind map, else on the one showing the active
   * file - with several maps open, "the first one" is rarely the one meant.
   */
  private withMindmap(run: (view: MindmapView) => void): void {
    const file = this.app.workspace.getActiveFile();
    const views = this.mindmapViews();
    const view =
      this.app.workspace.getActiveViewOfType(MindmapView) ??
      (file && views.find((v) => v.currentFile?.path === file.path)) ??
      views[0];

    if (!view) {
      new Notice('No mind map is open.');

      return;
    }
    run(view);
  }

  /**
   * From the map, focuses its Markdown pane; from Markdown, focuses (or
   * opens) the mind map for the active file.
   */
  private async toggleMindmapFocus(): Promise<void> {
    const mindmap = this.app.workspace.getActiveViewOfType(MindmapView);

    if (mindmap) {
      await mindmap.focusEditor();

      return;
    }
    await this.openMindmap();
  }

  /**
   * Opens the map for `target`, or for the active file when given none.
   * `linked` is how you say "and leave one here": a map follows the active
   * file, so asking for the map of the note in front of you can only mean
   * "show me the one I already have".
   */
  private async openMindmap(
    target?: TFile,
    linked = false,
    from?: WorkspaceLeaf,
  ): Promise<void> {
    const file = target ?? this.app.workspace.getActiveFile();

    if (!file || file.extension !== 'md') {
      new Notice('Open a Markdown file first.');

      return;
    }
    const near = this.isMobile
      ? this.app.workspace.getLeaf(false)
      : this.paneFor(file, from);
    const already = this.mapLeaves().find(
      (leaf) =>
        (this.isMobile && this.mapFile(leaf) === file.path) ||
        (!this.isMobile &&
          (linked
            ? !!near && this.tiedTo(leaf, near)
            : this.mapFile(leaf) === file.path &&
              (!near || sameWindow(leaf, near)))),
    );

    if (already) {
      await this.app.workspace.revealLeaf(already);
      // A repeated Link request can still enable Auto-open.
      if (linked && !this.isMobile && already.view instanceof MindmapView) {
        await this.rememberLinkedMap(file);
      }

      return;
    }
    const cursorLine = this.cursorLineFor(file, near);
    const sourceHeight =
      near?.view instanceof MarkdownView ? near.view.contentEl.clientHeight : 0;

    const leaf = this.newMapLeaf(near, linked);

    await leaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      active: true,
      state: { file: file.path },
    });
    // Asked for by note, so it is tied to that note's tab rather than left to
    // the active file. Obsidian's own link, undone from the tab menu - the
    // map keeps no follow flag of its own.
    if (linked && !this.isMobile && leaf.view instanceof MindmapView) {
      await leaf.view.linkToEditor();
    }
    if (this.isMobile) {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
    } else {
      await this.app.workspace.revealLeaf(leaf);
    }
    if (leaf.view instanceof MindmapView) {
      leaf.view.initialViewportAfterReveal(cursorLine);
    }
    if (!this.isMobile) {
      this.keepMarkdownCursorVisible(file, near, cursorLine, sourceHeight);
    }
  }

  /** Keeps a source caret visible after a new split reduces its pane height. */
  private keepMarkdownCursorVisible(
    file: TFile,
    leaf: WorkspaceLeaf | null,
    line: number | null,
    previousHeight: number,
  ): void {
    const view = leaf?.view;

    if (
      line === null ||
      previousHeight <= 0 ||
      !(view instanceof MarkdownView) ||
      view.file?.path !== file.path ||
      view.getMode() !== 'source'
    ) {
      return;
    }
    const reveal = (): void => {
      if (
        view.file?.path !== file.path ||
        view.contentEl.clientHeight >= previousHeight ||
        line > view.editor.lastLine()
      ) {
        return;
      }
      const ch = view.editor.getLine(line).length;

      view.editor.scrollIntoView(
        { from: { line, ch: 0 }, to: { line, ch } },
        true,
      );
    };
    const win = view.containerEl.win;

    reveal();
    win.setTimeout(reveal, 350);
  }

  /** A meaningful caret from the Markdown pane that asked for a new map. */
  private cursorLineFor(
    file: TFile,
    leaf: WorkspaceLeaf | null,
  ): number | null {
    const view = leaf?.view;

    if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
      return null;
    }
    const active = view.containerEl.doc.activeElement;
    const title = active?.closest('.inline-title, .view-header-title');

    return title && view.containerEl.contains(title)
      ? null
      : view.editor.getCursor().line;
  }

  /**
   * The pane every window question is answered from: the one showing `file`
   * nearest whoever asked - a tab menu names its own, a command has none.
   */
  private paneFor(file: TFile, from?: WorkspaceLeaf): WorkspaceLeaf | null {
    const asked = from ?? this.app.workspace.getMostRecentLeaf();

    return findMarkdownView(this.app, file, asked ?? undefined)?.leaf ?? asked;
  }

  /**
   * Where a new map goes. A linked map is its note's, so the pane already
   * split off that note takes it as a tab and failing that it splits one off.
   * A roaming map has none, so it joins the maps open in that window instead.
   */
  private newMapLeaf(
    near: WorkspaceLeaf | null,
    linked: boolean,
  ): WorkspaceLeaf {
    if (this.isMobile) {
      return this.app.workspace.getLeaf('tab');
    }
    if (linked && near) {
      // Switching a note's tab and asking again would add a column each
      // time, so the pane already split off it takes this one.
      const column = this.mapLeaves().find((leaf) =>
        sameSplit(leaf, near),
      )?.parent;

      return column
        ? this.app.workspace.createLeafInParent(column, -1)
        : this.openSplit(near);
    }
    const beside = this.mapLeaves().find(
      (leaf) => !near || sameWindow(leaf, near),
    )?.parent;

    return beside
      ? this.app.workspace.createLeafInParent(beside, -1)
      : this.openSplit(near);
  }

  /**
   * A new pane in the configured direction, split off `near`: the active leaf
   * `getLeaf` would split is not always in the window that asked.
   */
  openSplit(near?: WorkspaceLeaf | null): WorkspaceLeaf {
    if (this.isMobile) {
      return this.app.workspace.getLeaf('tab');
    }

    return near
      ? this.app.workspace.createLeafBySplit(near, this.settings.splitDirection)
      : this.app.workspace.getLeaf('split', this.settings.splitDirection);
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<MindmapSettings>;

    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    this.settings.autoOpenFiles = Array.isArray(this.settings.autoOpenFiles)
      ? [
          ...new Set(
            this.settings.autoOpenFiles.filter(
              (path): path is string => typeof path === 'string',
            ),
          ),
        ]
      : [];
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (leaf.view instanceof MindmapView) {
        leaf.view.refresh();
      }
    }
  }
}
