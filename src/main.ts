import {
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
} from 'obsidian';
import {
  MINDMAP_ICON,
  MindmapView,
  VIEW_TYPE_MINDMAP,
} from './obsidian/map/mindmap-view';
import { FoldKind } from './core/folds';
import { DEFAULT_SETTINGS, MindmapSettings } from './core/settings';
import { findMarkdownView } from './obsidian/markdown/file-io';
import { sameSplit, sameWindow, moveLeafToSplit } from './obsidian/workspace';
import { MindmapSettingTab } from './obsidian/settings';
import { AutoOpenMaps } from './obsidian/map/auto-open';
import {
  anchorFor,
  NodeBookmark,
  nodeBookmarksFrom,
  renameBookmarkFiles,
  updateBookmarkAnchor,
} from './core/bookmarks';
import { MindNode, parseMarkdown } from './core/parse/parser';

function descendantFilePaths(file: TAbstractFile): string[] {
  if (file instanceof TFile) {
    return [file.path];
  }

  if (!(file instanceof TFolder)) {
    return [];
  }

  return file.children.flatMap(descendantFilePaths);
}

export default class MindmapPlugin extends Plugin {
  settings!: MindmapSettings;
  private autoOpen!: AutoOpenMaps;
  private readonly bookmarkSources = new Map<string, string>();
  private bookmarkUpdate: Promise<void> = Promise.resolve();
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
    await this.seedBookmarkSources();
    this.autoOpen = new AutoOpenMaps(this, (file) => {
      void this.openMindmap(file, true);
    });
    this.registerView(
      VIEW_TYPE_MINDMAP,
      (leaf: WorkspaceLeaf) => new MindmapView(leaf, this),
    );
    this.addRibbonIcon(MINDMAP_ICON, 'Open mind map', () => {
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
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (
          file instanceof TFile &&
          file.extension === 'md' &&
          this.settings.bookmarks.some(
            (bookmark) => bookmark.file === file.path,
          )
        ) {
          this.queueBookmarkUpdate(file);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.renameStoredFile(file, oldPath);
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.deleteStoredFile(file);
      }),
    );
    this.autoOpen.register();
    this.addSettingTab(new MindmapSettingTab(this.app, this));
  }

  bookmarksFor(file: TFile | null): NodeBookmark[] {
    if (!file) {
      return [];
    }

    return this.settings.bookmarks.filter(
      (bookmark) => bookmark.file === file.path,
    );
  }

  async addBookmark(
    file: TFile,
    node: MindNode,
    source: string,
  ): Promise<void> {
    const anchor = anchorFor(node);

    this.bookmarkSources.set(file.path, source);
    this.settings.bookmarks.push({
      ...anchor,
      id: crypto.randomUUID(),
      file: file.path,
      name: null,
      unresolved: false,
    });
    await this.saveData(this.settings);
    this.refreshBookmarkViews(file.path);
  }

  async removeBookmark(id: string): Promise<void> {
    const removed = this.settings.bookmarks.find(
      (bookmark) => bookmark.id === id,
    );

    this.settings.bookmarks = this.settings.bookmarks.filter(
      (bookmark) => bookmark.id !== id,
    );
    if (
      removed &&
      !this.settings.bookmarks.some(
        (bookmark) => bookmark.file === removed.file,
      )
    ) {
      this.bookmarkSources.delete(removed.file);
    }
    await this.saveData(this.settings);
    this.refreshBookmarkViews(removed?.file);
  }

  async renameBookmark(id: string, name: string | null): Promise<void> {
    const bookmark = this.settings.bookmarks.find((item) => item.id === id);

    if (!bookmark) {
      return;
    }
    bookmark.name = name;
    await this.saveData(this.settings);
  }

  async resetBookmarks(file?: TFile): Promise<void> {
    if (file) {
      this.settings.bookmarks = this.settings.bookmarks.filter(
        (bookmark) => bookmark.file !== file.path,
      );
      this.bookmarkSources.delete(file.path);
    } else {
      this.settings.bookmarks = [];
      this.bookmarkSources.clear();
    }
    await this.saveData(this.settings);
    this.refreshBookmarkViews(file?.path);
  }

  private refreshBookmarkViews(filePath?: string): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)) {
      if (
        leaf.view instanceof MindmapView &&
        (!filePath || leaf.view.currentFile?.path === filePath)
      ) {
        leaf.view.refresh();
      }
    }
  }

  private renameStoredFile(file: TAbstractFile, oldPath: string): void {
    for (const path of descendantFilePaths(file)) {
      const oldKey = `mindmap-editor:viewport:${oldPath}${path.slice(file.path.length)}`;
      const state: unknown = this.app.loadLocalStorage(oldKey);

      if (state) {
        this.app.saveLocalStorage(`mindmap-editor:viewport:${path}`, state);
        this.app.saveLocalStorage(oldKey, null);
      }
    }
    const oldPrefix = `${oldPath}/`;
    const renamed = renameBookmarkFiles(
      this.settings.bookmarks,
      oldPath,
      file.path,
    );

    if (!renamed) {
      return;
    }
    const movedSources = [...this.bookmarkSources].filter(
      ([path]) => path === oldPath || path.startsWith(oldPrefix),
    );

    for (const [path, source] of movedSources) {
      this.bookmarkSources.delete(path);
      this.bookmarkSources.set(
        `${file.path}${path.slice(oldPath.length)}`,
        source,
      );
    }
    void this.saveData(this.settings);
  }

  private deleteStoredFile(file: TAbstractFile): void {
    const paths = new Set(descendantFilePaths(file));

    paths.forEach((path) =>
      this.app.saveLocalStorage(`mindmap-editor:viewport:${path}`, null),
    );
    const kept = this.settings.bookmarks.filter(
      (bookmark) => !paths.has(bookmark.file),
    );

    if (kept.length === this.settings.bookmarks.length) {
      return;
    }
    this.settings.bookmarks = kept;
    paths.forEach((path) => this.bookmarkSources.delete(path));
    void this.saveData(this.settings);
  }

  private queueBookmarkUpdate(file: TFile): void {
    this.bookmarkUpdate = this.bookmarkUpdate
      .then(() => this.updateBookmarks(file))
      .catch((err) =>
        console.error('Mindmap: could not update bookmarks', err),
      );
  }

  private async updateBookmarks(file: TFile): Promise<void> {
    const after = await this.app.vault.cachedRead(file);
    const before = this.bookmarkSources.get(file.path);

    this.bookmarkSources.set(file.path, after);
    if (before === undefined || before === after) {
      return;
    }
    const root = parseMarkdown(after, file.basename);
    let changed = false;
    const deleted = new Set<string>();

    for (const bookmark of this.settings.bookmarks) {
      if (bookmark.file !== file.path) {
        continue;
      }
      const result = updateBookmarkAnchor(bookmark, root, before, after);

      if (result === 'deleted') {
        deleted.add(bookmark.id);
      }
      if (result !== 'unchanged') {
        changed = true;
      }
    }
    if (deleted.size) {
      this.settings.bookmarks = this.settings.bookmarks.filter(
        (bookmark) => !deleted.has(bookmark.id),
      );
    }
    if (changed) {
      await this.saveData(this.settings);
      this.refreshBookmarkViews(file.path);
    }
  }

  private async seedBookmarkSources(): Promise<void> {
    const paths = [
      ...new Set(this.settings.bookmarks.map((item) => item.file)),
    ];

    await Promise.all(
      paths.map(async (path) => {
        if (this.bookmarkSources.has(path)) {
          return;
        }
        const file = this.app.vault.getAbstractFileByPath(path);

        if (file instanceof TFile) {
          this.bookmarkSources.set(path, await this.app.vault.cachedRead(file));
        }
      }),
    );
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
            .setIcon(MINDMAP_ICON)
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
      sameWindow(leaf, tab) &&
      !!group &&
      group === (tab as WorkspaceLeaf & { group?: string }).group
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
      await this.reuseMap(already, file, near, linked);

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
    const view = leaf.view;

    if (!(view instanceof MindmapView)) {
      await this.revealMap(leaf);

      return;
    }
    if (linked && !this.isMobile) {
      await view.linkToEditor();
    }
    await this.revealMap(leaf);
    view.initialViewportAfterReveal(cursorLine);
    if (this.isMobile) {
      return;
    }
    this.keepMarkdownCursorVisible(file, near, cursorLine, sourceHeight);
  }

  private async revealMap(leaf: WorkspaceLeaf): Promise<void> {
    if (this.isMobile) {
      this.app.workspace.setActiveLeaf(leaf, { focus: true });

      return;
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async reuseMap(
    leaf: WorkspaceLeaf,
    file: TFile,
    near: WorkspaceLeaf | null,
    linked: boolean,
  ): Promise<void> {
    const shown = await this.ensureMapSplit(leaf, near);

    await this.app.workspace.revealLeaf(shown);
    // A repeated Link request can still enable Auto-open.
    if (linked && !this.isMobile && shown.view instanceof MindmapView) {
      await this.rememberLinkedMap(file);
    }
  }

  private async ensureMapSplit(
    leaf: WorkspaceLeaf,
    near: WorkspaceLeaf | null,
  ): Promise<WorkspaceLeaf> {
    if (this.isMobile || !near || leaf.parent !== near.parent) {
      return leaf;
    }

    return moveLeafToSplit(this.app, leaf, near, this.settings.splitDirection);
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
    const active = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
    const asked = from ?? active ?? this.app.workspace.getMostRecentLeaf();

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
      (leaf) =>
        !near || (sameWindow(leaf, near) && leaf.parent !== near.parent),
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
    delete (this.settings as MindmapSettings & { bookmarksEnabled?: unknown })
      .bookmarksEnabled;
    this.settings.autoOpenFiles = Array.isArray(this.settings.autoOpenFiles)
      ? [
          ...new Set(
            this.settings.autoOpenFiles.filter(
              (path): path is string => typeof path === 'string',
            ),
          ),
        ]
      : [];
    this.settings.bookmarks = nodeBookmarksFrom(this.settings.bookmarks);
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
