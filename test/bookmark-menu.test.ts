// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindmapView } from '../src/obsidian/map/mindmap-view';
import { parseMarkdown, type MindNode } from '../src/core/parse/parser';
import { installObsidianDom } from './stubs/obsidian-dom';

const mocks = vi.hoisted(() => {
  class TestItem {
    title: string | DocumentFragment = '';
    icon = '';
    click: (() => void) | null = null;
    disabled = false;

    setTitle(title: string | DocumentFragment): this {
      this.title = title;

      return this;
    }
    setIcon(icon: string): this {
      this.icon = icon;

      return this;
    }
    setDisabled(disabled = true): this {
      this.disabled = disabled;

      return this;
    }
    setWarning(): this {
      return this;
    }
    onClick(click: () => void): this {
      this.click = click;

      return this;
    }
  }

  class TestMenu {
    items: TestItem[] = [];
    useNative = true;
    hidden = false;

    constructor() {
      menus.push(this);
    }
    addItem(add: (item: TestItem) => void): this {
      const item = new TestItem();

      add(item);
      this.items.push(item);

      return this;
    }
    addSeparator(): this {
      return this;
    }
    setUseNativeMenu(useNative: boolean): this {
      this.useNative = useNative;

      return this;
    }
    showAtMouseEvent(): this {
      return this;
    }
    hide(): void {
      this.hidden = true;
    }
  }

  const menus: TestMenu[] = [];

  return { menus, TestMenu };
});

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ItemView: class {},
  Menu: mocks.TestMenu,
}));

const { menus } = mocks;

installObsidianDom();

beforeEach(() => menus.splice(0));

describe('bookmark menus', () => {
  it('adds a bookmark from the node menu', async () => {
    const root = parseMarkdown('- target', 'Note');
    const node = root.children[0]!;
    const addBookmark = vi.fn();
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      root,
      renderedSource: '- target',
      file: { path: 'Note.md', basename: 'Note' },
      getFileText: vi.fn().mockResolvedValue('- target'),
      plugin: {
        bookmarksFor: () => [],
        addBookmark,
      },
      collapsedBranches: new Set(),
      foldedText: new Set(),
    });
    const show = Reflect.get(view, 'showNodeMenu') as (
      this: MindmapView,
      node: MindNode,
      el: HTMLElement,
      event: MouseEvent,
    ) => void;

    show.call(
      view,
      node,
      document.createElement('div'),
      new MouseEvent('contextmenu'),
    );
    menus[0]?.items.find((item) => item.title === 'Add bookmark')?.click?.();

    await vi.waitFor(() =>
      expect(addBookmark).toHaveBeenCalledWith(
        view.currentFile,
        node,
        '- target',
      ),
    );
  });

  it('offers individual removal from the bookmark menu', () => {
    const removeBookmark = vi.fn();
    const view = Object.create(MindmapView.prototype) as MindmapView;
    const bookmark = {
      id: 'missing',
      file: 'Note.md',
      name: null,
      type: 'list',
      text: 'gone',
      line: 1,
      ancestors: [],
      unresolved: true,
    };

    Object.assign(view, {
      file: { path: 'Note.md' },
      plugin: {
        bookmarksFor: () => [bookmark],
        removeBookmark,
      },
      containerEl: { doc: document, win: window },
    });
    const show = Reflect.get(view, 'showBookmarksMenu') as (
      this: MindmapView,
      event: MouseEvent,
    ) => void;

    show.call(view, new MouseEvent('click'));
    const title = menus[0]?.items[0]?.title;
    const remove =
      !title || typeof title === 'string'
        ? null
        : title.querySelector<HTMLElement>('.mindmap-bookmark-remove');

    remove?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(menus[0]?.items[0]?.disabled).toBe(false);
    expect(removeBookmark).toHaveBeenCalledWith('missing');
    expect(menus[0]?.hidden).toBe(true);
  });

  it('relocates a stale rendered node before bookmarking it', async () => {
    const rendered = '- old name';
    const current = '- new name';
    const node = parseMarkdown(rendered, 'Note').children[0]!;
    const addBookmark = vi.fn().mockResolvedValue(undefined);
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      file: { path: 'Note.md', basename: 'Note' },
      renderedSource: rendered,
      getFileText: vi.fn().mockResolvedValue(current),
      plugin: { addBookmark },
    });
    const add = Reflect.get(view, 'addNodeBookmark') as (
      this: MindmapView,
      target: MindNode,
    ) => Promise<void>;

    await add.call(view, node);

    expect(addBookmark).toHaveBeenCalledWith(
      view.currentFile,
      expect.objectContaining({ text: 'new name', line: 0 }),
      current,
    );
  });

  it('offers removal of every bookmark at the bottom of the menu', () => {
    const file = { path: 'Note.md' };
    const resetBookmarks = vi.fn();
    const confirm = vi.fn(() => true);
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      file,
      plugin: {
        bookmarksFor: () => [{ id: 'saved' }],
        resetBookmarks,
      },
      containerEl: { doc: document, win: { confirm } },
    });
    const show = Reflect.get(view, 'showBookmarksMenu') as (
      this: MindmapView,
      event: MouseEvent,
    ) => void;

    show.call(view, new MouseEvent('click'));
    const removeAll = menus[0]?.items.at(-1);

    removeAll?.click?.();

    expect(removeAll?.title).toBe('Remove all bookmarks');
    expect(removeAll?.icon).toBe('trash');
    expect(confirm).toHaveBeenCalledWith('Remove all bookmarks for this note?');
    expect(resetBookmarks).toHaveBeenCalledWith(file);
  });

  it('does not attach an unresolved bookmark to a remaining duplicate', () => {
    const root = parseMarkdown('# Parent\n- same', 'Note');
    const node = root.children[0]!.children[0]!;
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      root,
      file: { path: 'Note.md' },
      plugin: {
        bookmarksFor: () => [
          {
            id: 'missing',
            file: 'Note.md',
            name: null,
            type: 'list',
            text: 'same',
            line: 2,
            ancestors: ['Parent'],
            unresolved: true,
          },
        ],
      },
    });
    const bookmarkFor = Reflect.get(view, 'bookmarkFor') as (
      this: MindmapView,
      node: MindNode,
    ) => unknown;

    expect(bookmarkFor.call(view, node)).toBeNull();
  });

  it('recognizes a bookmark on one of two identical siblings', () => {
    const root = parseMarkdown('# Parent\n- same\n- same', 'Note');
    const node = root.children[0]!.children[1]!;
    const bookmark = {
      id: 'second',
      file: 'Note.md',
      name: null,
      type: 'list',
      text: 'same',
      line: 2,
      ancestors: ['Parent'],
      unresolved: false,
    };
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      root,
      file: { path: 'Note.md' },
      plugin: { bookmarksFor: () => [bookmark] },
    });
    const bookmarkFor = Reflect.get(view, 'bookmarkFor') as (
      this: MindmapView,
      node: MindNode,
    ) => unknown;

    expect(bookmarkFor.call(view, node)).toBe(bookmark);
    expect(bookmarkFor.call(view, root.children[0]!.children[0]!)).toBeNull();
  });

  it('shows the Markdown node kind beside each bookmark', () => {
    const view = Object.create(MindmapView.prototype) as MindmapView;
    const bookmarks = [
      {
        id: 'heading',
        file: 'Note.md',
        name: null,
        type: 'heading',
        text: 'Section',
        line: 0,
        ancestors: [],
        level: 2,
        marker: '',
        checked: null,
        unresolved: false,
      },
      {
        id: 'task',
        file: 'Note.md',
        name: null,
        type: 'list',
        text: 'Task',
        line: 1,
        ancestors: ['Section'],
        level: 0,
        marker: '-',
        checked: false,
        unresolved: false,
      },
      {
        id: 'ordered',
        file: 'Note.md',
        name: null,
        type: 'list',
        text: '1. Numbered item',
        line: 2,
        ancestors: ['Section'],
        level: 0,
        marker: '-',
        checked: null,
        unresolved: false,
      },
    ];

    Object.assign(view, {
      file: { path: 'Note.md' },
      plugin: { bookmarksFor: () => bookmarks },
      containerEl: { doc: document, win: window },
    });
    const show = Reflect.get(view, 'showBookmarksMenu') as (
      this: MindmapView,
      event: MouseEvent,
    ) => void;

    show.call(view, new MouseEvent('click'));

    expect(menus[0]?.useNative).toBe(false);
    expect(menus[0]?.items.slice(0, 3).map((item) => item.icon)).toEqual([
      'heading-2',
      'list-checks',
      'list-ordered',
    ]);
    const orderedTitle = menus[0]?.items[2]?.title;

    expect(
      typeof orderedTitle === 'string'
        ? orderedTitle
        : orderedTitle?.querySelector('.mindmap-bookmark-menu-label')
            ?.textContent,
    ).toBe('Numbered item');
  });

  it('lists bookmarks in document order with missing nodes last', () => {
    const item = (id: string, line: number, unresolved = false) => ({
      id,
      file: 'Note.md',
      name: null,
      type: 'list' as const,
      text: id,
      line,
      ancestors: [],
      marker: '-',
      unresolved,
    });
    const view = Object.create(MindmapView.prototype) as MindmapView;

    Object.assign(view, {
      file: { path: 'Note.md' },
      plugin: {
        bookmarksFor: () => [
          item('last', 8),
          item('missing', 1, true),
          item('first', 2),
        ],
      },
      containerEl: { doc: document, win: window },
    });
    const show = Reflect.get(view, 'showBookmarksMenu') as (
      this: MindmapView,
      event: MouseEvent,
    ) => void;

    show.call(view, new MouseEvent('click'));

    expect(
      menus[0]?.items
        .slice(0, 3)
        .map((entry) =>
          typeof entry.title === 'string'
            ? entry.title
            : entry.title.querySelector('.mindmap-bookmark-menu-label')
                ?.textContent,
        ),
    ).toEqual(['first', 'last', 'missing (not found)']);
  });
});
