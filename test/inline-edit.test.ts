// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runEditor } from '../src/obsidian/map/inline-edit';
import { installObsidianDom } from './stubs/obsidian-dom';

installObsidianDom();

/** An editor on the page, with the view's side of it spied on. */
function open(options: { multiline: boolean; text?: string }) {
  const host = document.createElement('div');
  const input = document.createElement('div');

  host.className = 'mindmap-node';
  host.appendChild(input);
  document.body.appendChild(host);
  input.textContent = options.text ?? 'before';
  // jsdom does not make a contenteditable focusable; the editor's keys are
  // gated on holding the focus, so the test has to be able to give it.
  input.tabIndex = -1;

  const commit = vi.fn(() => true);
  const restore = vi.fn();
  const setEditing = vi.fn();
  let saveKey = (): void => undefined;

  runEditor({
    input,
    multiline: options.multiline,
    placeCaret: () => undefined,
    restore,
    commit,
    setEditing,
    reflow: () => undefined,
    settle: () => false,
    bindSave: (save) => {
      saveKey = save;

      return () => {
        saveKey = () => undefined;
      };
    },
  });

  const press = (key: string, mods: Partial<KeyboardEvent> = {}): void => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...mods }),
    );
  };

  return {
    input,
    host,
    commit,
    restore,
    setEditing,
    press,
    save: () => saveKey(),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('a single-line edit', () => {
  it('saves on Enter, with the text it holds', () => {
    const e = open({ multiline: false, text: 'typed' });

    e.input.focus();
    e.press('Enter');

    expect(e.commit).toHaveBeenCalledWith('typed');
    expect(e.restore).not.toHaveBeenCalled();
  });

  it('discards on Escape, and saves nothing', () => {
    const e = open({ multiline: false });

    e.input.focus();
    e.press('Escape');

    expect(e.commit).not.toHaveBeenCalled();
    expect(e.restore).toHaveBeenCalled();
  });

  it('flattens the line breaks of pasted text', () => {
    const e = open({ multiline: false, text: 'one\ntwo' });

    e.input.focus();
    e.press('Enter');

    expect(e.commit).toHaveBeenCalledWith('one two');
  });
});

describe('a multi-line edit', () => {
  it('lets Enter be a line break', () => {
    const e = open({ multiline: true });

    e.input.focus();
    e.press('Enter');

    expect(e.commit).not.toHaveBeenCalled();
    expect(e.restore).not.toHaveBeenCalled();
  });

  it('saves on Ctrl+Enter', () => {
    const e = open({ multiline: true, text: 'body' });

    e.input.focus();
    e.press('Enter', { ctrlKey: true });

    expect(e.commit).toHaveBeenCalledWith('body');
  });

  it('saves on the shortcut the view registered, wherever it came from', () => {
    const e = open({ multiline: true, text: 'body' });

    e.input.focus();
    e.save();

    expect(e.commit).toHaveBeenCalledWith('body');
  });

  it('discards on Escape', () => {
    const e = open({ multiline: true, text: 'body' });

    e.input.focus();
    e.press('Escape');

    expect(e.commit).not.toHaveBeenCalled();
    expect(e.restore).toHaveBeenCalled();
  });

  it('keeps the line the user made with Enter', () => {
    const e = open({ multiline: true, text: 'one' });

    e.input.focus();
    // What the browser does to a contenteditable on Enter: a new element.
    e.input.appendChild(
      Object.assign(document.createElement('div'), { textContent: 'two' }),
    );
    e.press('Enter', { ctrlKey: true });

    expect(e.commit).toHaveBeenCalledWith('one\ntwo');
  });

  it('has save and discard buttons that do just that', () => {
    const saved = open({ multiline: true, text: 'body' });

    saved.input.focus();
    saved.host
      .querySelector<HTMLElement>('.mindmap-edit-controls > *')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(saved.commit).toHaveBeenCalledWith('body');

    const dropped = open({ multiline: true, text: 'body' });

    dropped.input.focus();
    dropped.host
      .querySelectorAll<HTMLElement>('.mindmap-edit-controls > *')[1]
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(dropped.commit).not.toHaveBeenCalled();
    expect(dropped.restore).toHaveBeenCalled();
  });

  it('puts its buttons on the node, not in the text', () => {
    const e = open({ multiline: true });

    // A row of their own would make the node taller as the edit opens.
    expect(e.input.querySelector('.mindmap-edit-controls')).toBe(null);
    expect(e.host.querySelector('.mindmap-edit-controls')).not.toBe(null);
  });
});

describe('an edit in the middle of an IME composition', () => {
  it('lets the composing Enter through to the IME', () => {
    const e = open({ multiline: false });

    e.input.focus();
    e.press('Enter', { isComposing: true });

    expect(e.commit).not.toHaveBeenCalled();
    expect(e.restore).not.toHaveBeenCalled();
  });
});

describe('leaving an edit', () => {
  it('saves when the focus goes elsewhere', () => {
    const e = open({ multiline: true, text: 'body' });

    e.input.focus();
    e.input.dispatchEvent(new FocusEvent('blur'));

    expect(e.commit).toHaveBeenCalledWith('body');
  });

  it('says when it starts and when it is over', () => {
    const e = open({ multiline: false });

    expect(e.setEditing).toHaveBeenCalledWith(true);
    e.input.focus();
    e.press('Escape');
    expect(e.setEditing).toHaveBeenLastCalledWith(false);
  });

  it('takes its keys off the document when it goes', () => {
    const e = open({ multiline: false });

    e.input.focus();
    e.press('Escape');
    e.commit.mockClear();
    e.press('Enter');

    expect(e.commit).not.toHaveBeenCalled();
  });
});
