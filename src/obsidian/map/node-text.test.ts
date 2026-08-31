// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, type App } from 'obsidian';
import { installObsidianDom } from '../../../test/stubs/obsidian-dom';
import { renderNodeText } from './node-text';

installObsidianDom();

function appWithImage(found = true): {
  app: App;
  resolve: ReturnType<typeof vi.fn>;
  openLink: ReturnType<typeof vi.fn>;
} {
  const resolve = vi.fn(() => (found ? { path: 'assets/image.png' } : null));
  const openLink = vi.fn();
  const app = {
    metadataCache: {
      getFirstLinkpathDest: resolve,
    },
    vault: {
      getResourcePath: vi.fn(() => 'app://vault/assets/image.png'),
    },
    workspace: { openLinkText: openLink },
  } as unknown as App;

  return { app, resolve, openLink };
}

beforeAll(() => {
  vi.spyOn(window, 'open').mockImplementation(() => null);
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('renderNodeText images', () => {
  it('resolves a local embed through the vault and renders a preview', async () => {
    const { app, resolve } = appWithImage();
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '![[image.png]]',
      app,
      'Notes/source.md',
      new Component(),
    );

    const image = container.querySelector('img');

    expect(resolve).toHaveBeenCalledWith('image.png', 'Notes/source.md');
    expect(image?.getAttribute('src')).toBe('app://vault/assets/image.png');
    expect(image?.classList.contains('mindmap-node-image')).toBe(true);
  });

  it('uses a remote Markdown image directly', async () => {
    const { app, resolve } = appWithImage(false);
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '![diagram](https://example.com/image.png)',
      app,
      'source.md',
      new Component(),
    );

    const image = container.querySelector('img');

    expect(image?.getAttribute('src')).toBe('https://example.com/image.png');
    expect(image?.getAttribute('alt')).toBe('diagram');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves a local Markdown image through the vault', async () => {
    const { app, resolve } = appWithImage();
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '![diagram](<My Image.png>)',
      app,
      'Notes/source.md',
      new Component(),
    );

    expect(resolve).toHaveBeenCalledWith('My Image.png', 'Notes/source.md');
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('decodes a local Markdown image path before vault resolution', async () => {
    const { app, resolve } = appWithImage();

    await renderNodeText(
      document.body.createDiv(),
      '![diagram](My%20Image.png)',
      app,
      'Notes/source.md',
      new Component(),
    );

    expect(resolve).toHaveBeenCalledWith('My Image.png', 'Notes/source.md');
  });

  it('keeps the original syntax when a local image is missing', async () => {
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      'before ![[missing.png]] after',
      appWithImage(false).app,
      'source.md',
      new Component(),
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('before ![[missing.png]] after');
  });

  it('restores the syntax when a resolved preview fails to load', async () => {
    const container = document.body.createDiv();
    const settled = vi.fn();

    await renderNodeText(
      container,
      '![[image.png]]',
      appWithImage().app,
      'source.md',
      new Component(),
      undefined,
      settled,
    );
    settled.mockClear();
    container.querySelector('img')?.dispatchEvent(new Event('error'));

    expect(container.textContent).toBe('![[image.png]]');
    expect(settled).toHaveBeenCalledOnce();
  });

  it('reports when an image loads so the map can reflow', async () => {
    const container = document.body.createDiv();
    const settled = vi.fn();

    await renderNodeText(
      container,
      '![[image.png]]',
      appWithImage().app,
      'source.md',
      new Component(),
      undefined,
      settled,
    );
    settled.mockClear();
    container.querySelector('img')?.dispatchEvent(new Event('load'));

    expect(settled).toHaveBeenCalledOnce();
  });

  it('opens a local image without selecting its node', async () => {
    const { app, openLink } = appWithImage();
    const container = document.body.createDiv();
    const bubbled = vi.fn();

    container.addEventListener('click', bubbled);
    await renderNodeText(
      container,
      '![[image.png]]',
      app,
      'source.md',
      new Component(),
    );
    container
      .querySelector('img')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(openLink).toHaveBeenCalledWith('image.png', 'source.md', false);
    expect(bubbled).not.toHaveBeenCalled();
  });

  it('keeps non-image embeds and internal image syntax in code literal', async () => {
    const { app, resolve } = appWithImage();
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '![[file.pdf]] `![[code.png]]`',
      app,
      'source.md',
      new Component(),
    );

    expect(container.textContent).toBe('![[file.pdf]] ![[code.png]]');
    expect(container.querySelector('code')?.textContent).toBe('![[code.png]]');
    expect(container.querySelector('img')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not swallow text resembling the old placeholder', async () => {
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      'MINDMAPIMAGEPLACEHOLDER0END',
      appWithImage().app,
      'source.md',
      new Component(),
    );

    expect(container.textContent).toBe('MINDMAPIMAGEPLACEHOLDER0END');
  });

  it('preserves leading indentation as literal text', async () => {
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '    indented code',
      appWithImage().app,
      'source.md',
      new Component(),
    );

    expect(container.textContent).toBe('    indented code');
  });

  it('stops rendered external links from bubbling to the node', async () => {
    const container = document.body.createDiv();
    const bubbled = vi.fn();

    container.addEventListener('click', bubbled);
    await renderNodeText(
      container,
      '[site](https://example.com)',
      appWithImage().app,
      'source.md',
      new Component(),
    );
    const link = container.querySelector('a');

    link?.addEventListener('click', (event) => event.preventDefault());
    link?.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    expect(bubbled).not.toHaveBeenCalled();
  });

  it('renders inline Markdown through Obsidian', async () => {
    const container = document.body.createDiv();

    await renderNodeText(
      container,
      '**bold** *italic* ~~gone~~ `code` $x$',
      appWithImage().app,
      'source.md',
      new Component(),
    );

    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('italic');
    expect(container.querySelector('del')?.textContent).toBe('gone');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('.math')?.textContent).toBe('x');
  });
});
