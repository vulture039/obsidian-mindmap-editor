import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { MindmapView, VIEW_TYPE_MINDMAP } from './obsidian/map/mindmap-view';
import { FoldKind } from './core/folds';
import { DEFAULT_SETTINGS, MindmapSettings } from './core/settings';
import { MindmapSettingTab } from './obsidian/settings';

export default class MindmapPlugin extends Plugin {
  settings!: MindmapSettings;
  /**
   * The note a map is pointing the Markdown side at right now. Showing it
   * makes it the active file, and the roaming map would follow it there -
   * clicking a map would drag every other one onto the same note. By path
   * rather than a flag: a note the user opens meanwhile is still theirs.
   */
  mapDrivenOpen: string | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
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
      id: 'toggle-node-text',
      name: 'Show or hide node text on the map',
      callback: () => {
        this.withMindmap((view) => view.toggleBodyText());
      },
    });
    this.addFoldCommands();
    this.addFileMenuItem();
    this.addSettingTab(new MindmapSettingTab(this.app, this));
  }

  /**
   * "Open mind map" on a note's own menu - the file explorer, a tab header,
   * a link. Without it a note has to be opened just to open its map, since
   * the command reads the active file.
   */
  private addFileMenuItem(): void {
    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== 'md') {
          return;
        }
        menu.addItem((item) =>
          item
            .setTitle('Open mind map')
            .setIcon('git-fork')
            .onClick(() => void this.openMindmap(file)),
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
  private async openMindmap(target?: TFile, linked = false): Promise<void> {
    const file = target ?? this.app.workspace.getActiveFile();

    if (!file || file.extension !== 'md') {
      new Notice('Open a Markdown file first.');

      return;
    }
    const showing = this.mindmapViews().find(
      (view) => view.currentFile?.path === file.path,
    );

    if (showing && !linked) {
      await this.app.workspace.revealLeaf(showing.leaf);

      return;
    }
    const leaf = this.newMapLeaf();

    await leaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      active: true,
      state: { file: file.path },
    });
    // Asked for by note, so it is tied to that note's tab rather than left to
    // the active file. Obsidian's own link, undone from the tab menu - the
    // map keeps no follow flag of its own.
    if (linked && leaf.view instanceof MindmapView) {
      await leaf.view.linkToEditor();
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  /**
   * Where a new map goes: a tab beside the maps already open. Splitting again
   * would divide a pane that is already half of one.
   */
  private newMapLeaf(): WorkspaceLeaf {
    const beside = this.mindmapViews()[0]?.leaf.parent;

    return beside
      ? this.app.workspace.createLeafInParent(beside, -1)
      : this.openSplit();
  }

  /** Opens a new pane split in the user's configured direction. */
  openSplit(): WorkspaceLeaf {
    return this.app.workspace.getLeaf('split', this.settings.splitDirection);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<MindmapSettings>,
    );
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
