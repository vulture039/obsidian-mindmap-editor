// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEditor } from '../src/obsidian/map/inline-edit';
import { singleLineValue } from '../src/core/write/edit-value';
import { installObsidianDom } from './stubs/obsidian-dom';

installObsidianDom();

/** An editor on the page, with the view's side of it spied on. */
function open(options: { text?: string } = {}) {
  const host = document.createElement('div');
  const input = document.createElement('div');

  host.className = 'mindmap-node';
  host.appendChild(input);
  document.body.appendChild(host);
  input.textContent = options.text ?? 'before';
  // jsdom does not make a contenteditable focusable; the editor's keys are
  // gated on holding the focus, so the test has to be able to give it.
  input.tabIndex = -1;

  const write = vi.fn();
  const restore = vi.fn();
  const setEditing = vi.fn();

  runEditor({
    input,
    value: () => singleLineValue(input.innerText),
    placeCaret: () => undefined,
    restore,
    write,
    setEditing,
    reflow: () => undefined,
    settle: () => false,
  });

  const press = (key: string, mods: Partial<KeyboardEvent> = {}): void => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, ...mods }),
    );
  };
  const type = (value: string): void => {
    input.textContent = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  return { input, host, write, restore, setEditing, press, type };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('typing', () => {
  it('reaches the file a moment after it stops', () => {
    const e = open({ text: 'one' });

    e.input.focus();
    e.type('one two');
    expect(e.write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(400);
    expect(e.write).toHaveBeenCalledWith('one two');
  });

  it('is one write for a run of keys, not one for each', () => {
    const e = open({ text: 'a' });

    e.input.focus();
    for (const value of ['ab', 'abc', 'abcd']) {
      e.type(value);
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(400);

    expect(e.write).toHaveBeenCalledTimes(1);
    expect(e.write).toHaveBeenCalledWith('abcd');
  });

  it('waits for an IME to be done before writing anything', () => {
    const e = open({ text: '' });

    e.input.focus();
    e.input.dispatchEvent(new CompositionEvent('compositionstart'));
    e.type('か');
    vi.advanceTimersByTime(400);
    expect(e.write).not.toHaveBeenCalled();

    e.type('漢字');
    e.input.dispatchEvent(new CompositionEvent('compositionend'));
    vi.advanceTimersByTime(400);
    expect(e.write).toHaveBeenCalledWith('漢字');
  });
});

describe('leaving an edit', () => {
  it('writes what has not gone yet, on Escape', () => {
    const e = open({ text: 'one' });

    e.input.focus();
    e.type('one more');
    e.press('Escape');

    expect(e.write).toHaveBeenCalledWith('one more');
    expect(e.restore).toHaveBeenCalled();
  });

  it('writes what has not gone yet, when the focus goes', () => {
    const e = open({ text: 'body' });

    e.input.focus();
    e.type('body and more');
    e.input.dispatchEvent(new FocusEvent('blur'));

    expect(e.write).toHaveBeenCalledWith('body and more');
  });

  it('says when it starts and when it is over', () => {
    const e = open();

    expect(e.setEditing).toHaveBeenCalledWith(true);
    e.input.focus();
    e.press('Escape');
    expect(e.setEditing).toHaveBeenLastCalledWith(false);
  });

  it('takes its keys off the document when it goes', () => {
    const e = open();

    e.input.focus();
    e.press('Escape');
    e.write.mockClear();
    e.type('typed after the end');
    vi.advanceTimersByTime(400);

    expect(e.write).not.toHaveBeenCalled();
  });
});

describe('the keys an edit keeps to itself', () => {
  it('ends a label edit on Enter', () => {
    const e = open({ text: 'name' });

    e.input.focus();
    e.press('Enter');

    expect(e.restore).toHaveBeenCalled();
  });

  it('lets the composing Enter through to the IME', () => {
    const e = open();

    e.input.focus();
    e.press('Enter', { isComposing: true });

    expect(e.restore).not.toHaveBeenCalled();
  });

  it('holds on to the focus when Tab is pressed', () => {
    const e = open();

    e.input.focus();
    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    e.input.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(e.restore).not.toHaveBeenCalled();
  });
});
