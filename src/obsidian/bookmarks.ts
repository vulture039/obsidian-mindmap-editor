import { App, Modal, Setting } from 'obsidian';

export class BookmarkNameModal extends Modal {
  constructor(
    app: App,
    private readonly initial: string,
    private readonly save: (name: string | null) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.setTitle('Bookmark name');
    let value = this.initial;

    new Setting(this.contentEl)
      .setName('Name')
      .setDesc('Leave blank to use the node text.')
      .addText((text) => {
        text.setValue(value).onChange((next) => {
          value = next;
        });
        text.inputEl.focus();
        text.inputEl.select();
        text.inputEl.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            this.submit(value);
          }
        });
      });
    new Setting(this.contentEl)
      .addButton((button) =>
        button.setButtonText('Cancel').onClick(() => this.close()),
      )
      .addButton((button) =>
        button
          .setButtonText('Save')
          .setCta()
          .onClick(() => this.submit(value)),
      );
  }

  private submit(value: string): void {
    const name = value.trim();

    this.save(name || null);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
