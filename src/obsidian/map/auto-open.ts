import { TFile } from 'obsidian';
import type MindmapPlugin from '../../main';
import {
  deleteAutoOpen,
  OpenMarkdownFiles,
  rememberAutoOpen,
  renameAutoOpen,
} from '../../core/auto-open';

/** Owns remembered-map persistence and the workspace events that restore it. */
export class AutoOpenMaps {
  private openMarkdownFiles: OpenMarkdownFiles | null = null;

  constructor(
    private readonly plugin: MindmapPlugin,
    private readonly open: (file: TFile) => void,
  ) {}

  register(): void {
    const { app } = this.plugin;

    this.plugin.registerEvent(
      app.workspace.on('file-open', (file) => {
        if (
          file instanceof TFile &&
          file.extension === 'md' &&
          this.openMarkdownFiles?.open(file.path)
        ) {
          this.openRemembered(file);
        }
        // Replacing the file in an existing Markdown tab does not emit a
        // layout change. Reconcile after Obsidian has updated that leaf, or
        // the previous file remains "open" here and cannot auto-open when the
        // same tab later returns to it.
        window.setTimeout(() => {
          this.openMarkdownFiles?.retain(this.openMarkdownPaths());
        }, 0);
      }),
    );
    this.plugin.registerEvent(
      app.workspace.on('layout-change', () => {
        this.openMarkdownFiles?.retain(this.openMarkdownPaths());
      }),
    );
    app.workspace.onLayoutReady(() => {
      this.openMarkdownFiles = new OpenMarkdownFiles(this.openMarkdownPaths());
      const active = app.workspace.getActiveFile();

      if (active?.extension === 'md') {
        this.openRemembered(active);
      }
    });
    this.plugin.registerEvent(
      app.vault.on('rename', (file, oldPath) => {
        this.openMarkdownFiles?.rename(oldPath, file.path);
        void this.replaceFiles(
          renameAutoOpen(
            this.plugin.settings.autoOpenFiles,
            oldPath,
            file.path,
          ),
        );
      }),
    );
    this.plugin.registerEvent(
      app.vault.on('delete', (file) => {
        void this.replaceFiles(
          deleteAutoOpen(this.plugin.settings.autoOpenFiles, file.path),
        );
      }),
    );
  }

  async remember(file: TFile): Promise<void> {
    await this.replaceFiles(
      rememberAutoOpen(this.plugin.settings.autoOpenFiles, file.path),
    );
  }

  async forget(file: TFile | null): Promise<void> {
    if (!file) {
      return;
    }
    await this.replaceFiles(
      deleteAutoOpen(this.plugin.settings.autoOpenFiles, file.path),
    );
  }

  isRemembered(file: TFile | null): boolean {
    return !!file && this.plugin.settings.autoOpenFiles.includes(file.path);
  }

  async toggle(file: TFile | null): Promise<void> {
    if (!file) {
      return;
    }
    if (this.isRemembered(file)) {
      await this.forget(file);
    } else {
      await this.remember(file);
    }
  }

  /** Every file that currently has at least one Markdown tab. */
  private openMarkdownPaths(): string[] {
    return this.plugin.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.getViewState().state?.file)
      .filter((path): path is string => typeof path === 'string');
  }

  private openRemembered(file: TFile): void {
    if (this.isRemembered(file)) {
      // `file-open` fires before Obsidian finishes activating the Markdown
      // leaf. Opening synchronously lets that remaining activation hide the
      // map again, especially on mobile where tabs cannot be side by side.
      window.setTimeout(() => {
        if (this.isRemembered(file)) {
          this.open(file);
        }
      }, 0);
    }
  }

  private async replaceFiles(files: string[]): Promise<void> {
    const current = this.plugin.settings.autoOpenFiles;
    const unchanged =
      files.length === current.length &&
      files.every((path, index) => path === current[index]);

    if (unchanged) {
      return;
    }
    this.plugin.settings.autoOpenFiles = files;
    await this.plugin.saveSettings();
  }
}
