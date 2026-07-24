import { Notice, Plugin, WorkspaceLeaf } from 'obsidian';
import { MindmapView, VIEW_TYPE_MINDMAP } from './obsidian/mindmap-view';
import {
  DEFAULT_SETTINGS,
  MindmapSettings,
  MindmapSettingTab,
} from './obsidian/settings';

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
    this.addSettingTab(new MindmapSettingTab(this.app, this));
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
      if (leaf.view instanceof MindmapView) leaf.view.refresh();
    }
  }
}
