'use strict';

/**
 * Every write to the vault, with what it changed and the code that called it.
 * A line going missing is the one bug the mind map must never have, and the
 * question is always the same: which write took it, and what asked for that
 * write. This answers both, and keeps answering after a restart.
 *
 * The log lands beside this file, outside the notes, so recording a write
 * cannot cause one.
 */
const { Plugin, MarkdownView } = require('obsidian');

const LOG = '.obsidian/plugins/mm-recorder/writes.log';
/** Enough of a long note to see the change in; the whole of a short one. */
const KEEP = 4000;
/** A day of use is nowhere near this; a runaway loop would be. */
const MAX_LOG = 20 * 1024 * 1024;

const lines = (text) => (text ?? '').split('\n');
const missing = (before, after) => {
  const had = lines(before);
  const has = lines(after);

  return had.filter(
    (l) => l.trim() && had.filter((x) => x === l).length > has.filter((x) => x === l).length,
  );
};

module.exports = class WriteRecorder extends Plugin {
  async onload() {
    this.undo = [];
    this.watchVault();
    this.app.workspace.onLayoutReady(() => this.watchEditor());
    for (const event of ['active-leaf-change', 'file-open', 'layout-change']) {
      this.registerEvent(
        this.app.workspace.on(event, () => this.watchEditor()),
      );
    }
    console.log('Write recorder: on. Log:', LOG);
  }

  onunload() {
    for (const put of this.undo.reverse()) {
      put();
    }
  }

  /** Appends one line of JSON; never through the vault, or it would record itself. */
  async note(entry) {
    const gone = missing(entry.before, entry.after);
    const text = JSON.stringify({
      at: new Date().toISOString(),
      ...entry,
      lines: `${lines(entry.before).length} -> ${lines(entry.after).length}`,
      // The whole point: what is in the file no longer.
      removed: gone.slice(0, 10),
      before: gone.length ? (entry.before ?? '').slice(0, KEEP) : undefined,
      after: gone.length ? (entry.after ?? '').slice(0, KEEP) : undefined,
    });

    const adapter = this.app.vault.adapter;
    const size = await adapter.stat(LOG).then((s) => s?.size ?? 0, () => 0);

    // Start again rather than fill the disk: what matters is the last write.
    await adapter[size > MAX_LOG ? 'write' : 'append'](LOG, `${text}\n`);
  }

  /** The two ways a plugin writes a whole file. */
  watchVault() {
    const vault = this.app.vault;

    for (const name of ['process', 'modify']) {
      const original = vault[name].bind(vault);

      vault[name] = async (file, arg, options) => {
        const stack = new Error().stack;
        const before = await vault.read(file).catch(() => '');
        const out = await original(file, arg, options);
        const after = typeof arg === 'string' ? arg : out;

        void this.note({ how: `vault.${name}`, path: file?.path, before, after, stack });

        return out;
      };
      this.undo.push(() => {
        vault[name] = original;
      });
    }
  }

  /** And the way one writes through an open editor, which is a line at a time. */
  watchEditor() {
    // Any Markdown pane will do - they share one editor prototype - and the
    // active view is usually the map, which has no editor at all.
    const view = this.app.workspace
      .getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .find((v) => v instanceof MarkdownView && v.editor);
    const proto = view?.editor && Object.getPrototypeOf(view.editor);

    if (!proto || proto.__recorded) {
      return;
    }
    proto.__recorded = true;
    const original = proto.replaceRange;
    const plugin = this;

    proto.replaceRange = function (text, from, to, origin) {
      const before = this.getValue();
      const stack = new Error().stack;
      const out = original.call(this, text, from, to, origin);
      const after = this.getValue();

      if (before !== after) {
        void plugin.note({ how: 'editor.replaceRange', path: view?.file?.path, before, after, stack });
      }

      return out;
    };
    this.undo.push(() => {
      proto.replaceRange = original;
      delete proto.__recorded;
    });
  }
};
