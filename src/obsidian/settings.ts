import {
  App,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
} from 'obsidian';
import type MindmapPlugin from '../main';

export class MindmapSettingTab extends PluginSettingTab {
  private readonly plugin: MindmapPlugin;

  constructor(app: App, plugin: MindmapPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Declarative settings (Obsidian 1.13+): rendered by the app and
   * included in the global settings search.
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: 'Hide completed tasks by default',
        desc: 'Start new maps with checked tasks grouped under a "✓ n done" node. Toggle each map from its header.',
        control: { type: 'toggle', key: 'hideCompleted' },
      },
      {
        name: 'Sync collapse state with Markdown folding',
        desc: 'Keep map branches and Markdown folds in sync. Reading view syncs headings only.',
        control: { type: 'toggle', key: 'syncFolds' },
      },
      {
        name: 'Show node text by default',
        desc: "Start new maps with each node's non-node lines shown inside it. Toggle each map with ¶ in its header.",
        control: { type: 'toggle', key: 'showBodyText' },
      },
      {
        name: 'Split direction',
        desc: 'Direction for new mind map or editor splits. Additional maps in an existing map pane open as tabs.',
        control: {
          type: 'dropdown',
          key: 'splitDirection',
          defaultValue: 'vertical',
          options: {
            vertical: 'Side by side (left and right)',
            horizontal: 'Stacked (top and bottom)',
          },
        },
      },
      {
        name: 'Remember linked maps',
        desc: 'Enable Auto-open when you explicitly link a map.',
        control: { type: 'toggle', key: 'rememberLinkedMaps' },
      },
      {
        name: 'Close linked map with source',
        desc: 'Close the map when its linked Markdown tab closes.',
        control: { type: 'toggle', key: 'closeLinkedMapWithSource' },
      },
      {
        name: 'Branch colors',
        desc: 'Top-level branch colors, one hex per line. Colors repeat; leave blank for defaults.',
        control: {
          type: 'textarea',
          key: 'palette',
          placeholder: '#3b82f6\n#ef4444\n#22c55e',
          rows: 5,
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  /**
   * Persist through the plugin so open mind map views refresh on every
   * change (the default would call saveData and skip that).
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
    await this.plugin.saveSettings();
  }

  /** Fallback for Obsidian < 1.13, built from the same definitions. */
  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    for (const def of this.getSettingDefinitions()) {
      if (!('control' in def) || !def.control) {
        continue;
      }
      const control = def.control;
      const setting = new Setting(containerEl).setName(def.name);

      if (typeof def.desc === 'string') {
        setting.setDesc(def.desc);
      }
      if (control.type === 'toggle') {
        setting.addToggle((toggle) =>
          toggle
            .setValue(Boolean(this.getControlValue(control.key)))
            .onChange((v) => this.setControlValue(control.key, v)),
        );
      } else if (control.type === 'dropdown') {
        setting.addDropdown((dropdown) =>
          dropdown
            .addOptions(control.options)
            .setValue(
              str(this.getControlValue(control.key)) ||
                (control.defaultValue ?? ''),
            )
            .onChange((v) => this.setControlValue(control.key, v)),
        );
      } else if (control.type === 'textarea') {
        setting.addTextArea((text) => {
          text
            .setPlaceholder(control.placeholder ?? '')
            .setValue(str(this.getControlValue(control.key)))
            .onChange((v) => this.setControlValue(control.key, v));
          if (control.rows) {
            text.inputEl.rows = control.rows;
          }
        });
      }
    }
  }
}
