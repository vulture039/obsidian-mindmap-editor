import {
  App,
  PluginSettingTab,
  Setting,
  SettingDefinitionItem,
} from 'obsidian';
import type MindmapPlugin from './main';

export interface MindmapSettings {
  followActiveFile: boolean;
  palette: string;
  // Collapse checked tasks into "✓ n done" pills; toggled from the view
  // header too, and remembered across sessions.
  hideCompleted: boolean;
  // Direction used whenever the plugin opens a split (map ⇄ editor).
  splitDirection: 'vertical' | 'horizontal';
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  followActiveFile: true,
  palette: '',
  hideCompleted: false,
  splitDirection: 'vertical',
};

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
        name: 'Follow active file',
        desc: 'Switch the mind map to whichever Markdown file becomes active.',
        control: { type: 'toggle', key: 'followActiveFile' },
      },
      {
        name: 'Hide completed tasks',
        desc: 'Collapse checked tasks into one "✓ n done" node per parent. Also toggled with the check-check button in the view header.',
        control: { type: 'toggle', key: 'hideCompleted' },
      },
      {
        name: 'Split direction',
        desc: 'How the workspace splits when the plugin opens a new pane (mind map or editor). Updates automatically when you rearrange the mind map pane.',
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
        name: 'Branch colors',
        desc: 'Colors assigned to top-level branches by position, one hex color per line. Branches beyond the last line cycle back to the first. Leave empty for the default palette.',
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
    return (this.plugin.settings as unknown as Record<string, unknown>)[
      key
    ];
  }

  /**
   * Persist through the plugin so open mind map views refresh on every
   * change (the default would call saveData and skip that).
   */
  async setControlValue(key: string, value: unknown): Promise<void> {
    (this.plugin.settings as unknown as Record<string, unknown>)[key] =
      value;
    await this.plugin.saveSettings();
  }

  /** Fallback for Obsidian < 1.13, built from the same definitions. */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const str = (v: unknown): string => (typeof v === 'string' ? v : '');
    for (const def of this.getSettingDefinitions()) {
      if (!('control' in def) || !def.control) continue;
      const control = def.control;
      const setting = new Setting(containerEl).setName(def.name);
      if (typeof def.desc === 'string') setting.setDesc(def.desc);
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
          text.setPlaceholder(control.placeholder ?? '')
            .setValue(str(this.getControlValue(control.key)))
            .onChange((v) => this.setControlValue(control.key, v));
          if (control.rows) text.inputEl.rows = control.rows;
        });
      }
    }
  }
}
