import { App, PluginSettingTab, Setting } from 'obsidian';
import type MindmapPlugin from './main';

export interface MindmapSettings {
	followActiveFile: boolean;
	colorOverrides: string;
	/** Collapse checked tasks into "✓ n done" pills; toggled from the view
	 *  header too, and remembered across sessions. */
	hideCompleted: boolean;
	/** Direction used whenever the plugin opens a split (map ⇄ editor). */
	splitDirection: 'vertical' | 'horizontal';
}

export const DEFAULT_SETTINGS: MindmapSettings = {
	followActiveFile: true,
	colorOverrides: '',
	hideCompleted: false,
	splitDirection: 'vertical',
};

export class MindmapSettingTab extends PluginSettingTab {
	private readonly plugin: MindmapPlugin;

	constructor(app: App, plugin: MindmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Follow active file')
			.setDesc(
				'Switch the mind map to whichever Markdown file becomes active.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.followActiveFile)
					.onChange(async (value) => {
						this.plugin.settings.followActiveFile = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Hide completed tasks')
			.setDesc(
				'Collapse checked tasks into one "✓ n done" node per parent. Also toggled with the check-check button in the view header.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.hideCompleted)
					.onChange(async (value) => {
						this.plugin.settings.hideCompleted = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Split direction')
			.setDesc(
				'How the workspace splits when the plugin opens a new pane (mind map or editor). Updates automatically when you rearrange the mind map pane.',
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('vertical', 'Side by side (left and right)')
					.addOption('horizontal', 'Stacked (top and bottom)')
					.setValue(this.plugin.settings.splitDirection)
					.onChange(async (value) => {
						this.plugin.settings.splitDirection =
							value === 'horizontal' ? 'horizontal' : 'vertical';
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Branch colors')
			.setDesc(
				'Override automatic branch colors. One rule per line, in the form "top-level heading text: #rrggbb". Branches without a rule keep their automatic color.',
			)
			.addTextArea((text) => {
				text.setPlaceholder('Projects: #e5484d')
					.setValue(this.plugin.settings.colorOverrides)
					.onChange(async (value) => {
						this.plugin.settings.colorOverrides = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
			});
	}
}
