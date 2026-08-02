import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { MindmapView, VIEW_TYPE_MINDMAP } from './obsidian/map/mindmap-view';
import { FoldKind } from './core/folds';
import { DEFAULT_SETTINGS, MindmapSettings } from './core/settings';
import { MindmapSettingTab } from './obsidian/settings';

export default class MindmapPlugin extends Plugin {
  settings!: MindmapSettings;

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
    this.addSettingTab(new MindmapSettingTab(this.app, this));
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

  /** Runs `run` on the focused mind map, else on any open one. */
  private withMindmap(run: (view: MindmapView) => void): void {
    const active = this.app.workspace.getActiveViewOfType(MindmapView);
    const view =
      active ?? this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)[0]?.view;

    if (!(view instanceof MindmapView)) {
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

  private async openMindmap(): Promise<void> {
    const file = this.app.workspace.getActiveFile();

    if (!file || file.extension !== 'md') {
      new Notice('Open a Markdown file first.');

      return;
    }
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP)[0];
    const leaf = existing ?? this.openSplit();

    await leaf.setViewState({
      type: VIEW_TYPE_MINDMAP,
      active: true,
      state: { file: file.path },
    });
    await this.app.workspace.revealLeaf(leaf);
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
