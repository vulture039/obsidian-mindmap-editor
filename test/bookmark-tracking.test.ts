import { describe, expect, it, vi } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import MindmapPlugin from '../src/main';
import { findByLine, parseMarkdown } from '../src/core/parse/parser';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Plugin: class {},
  TFile: class {},
  TFolder: class {},
}));
vi.mock('../src/obsidian/settings', () => ({ MindmapSettingTab: class {} }));
vi.mock('../src/obsidian/map/mindmap-view', () => ({
  MindmapView: class {},
  VIEW_TYPE_MINDMAP: 'mindmap-editor',
}));

describe('bookmark tracking lifecycle', () => {
  it('starts tracking from the rendered revision when the vault cache lags', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const rendered = '# Parent\n- renamed\n- added';
    let markdown = '# Parent\n- old';
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: { bookmarks: [] },
      bookmarkSources: new Map(),
      saveData: vi.fn().mockResolvedValue(undefined),
    });
    const node = findByLine(parseMarkdown(rendered, 'Note'), 1)!;

    await plugin.addBookmark(file, node, rendered);
    markdown = rendered;
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);

    expect(plugin.settings.bookmarks[0]).toMatchObject({
      text: 'renamed',
      unresolved: false,
    });
  });

  it('does not save bookmarks when an edit leaves their anchors unchanged', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const before = '# Parent\n- target\n\nold body';
    const after = '# Parent\n- target\n\nnew body';
    const bookmark = {
      id: 'target',
      file: file.path,
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      unresolved: false,
    };
    const saveData = vi.fn().mockResolvedValue(undefined);
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: { vault: { cachedRead: vi.fn(() => Promise.resolve(after)) } },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([[file.path, before]]),
      saveData,
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);

    expect(saveData).not.toHaveBeenCalled();
  });

  it('refreshes an open map after tracking changes its bookmarks', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const refreshBookmarkViews = vi.fn();
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: {
          cachedRead: vi.fn(() => Promise.resolve('# Parent\n- renamed')),
        },
      },
      settings: {
        bookmarks: [
          {
            id: 'target',
            file: file.path,
            name: null,
            type: 'list',
            text: 'target',
            line: 1,
            ancestors: ['Parent'],
            unresolved: false,
          },
        ],
      },
      bookmarkSources: new Map([[file.path, '# Parent\n- target']]),
      refreshBookmarkViews,
      saveData: vi.fn().mockResolvedValue(undefined),
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);

    expect(plugin.settings.bookmarks[0]?.text).toBe('renamed');
    expect(refreshBookmarkViews).toHaveBeenCalledOnce();
    expect(refreshBookmarkViews).toHaveBeenCalledWith(file.path);
  });

  it('starts a re-added bookmark from the current Markdown revision', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    let markdown = '# Intro\n# Parent\n- target';
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: {
        bookmarks: [
          {
            id: 'old',
            file: file.path,
            name: null,
            type: 'list',
            text: 'old',
            line: 1,
            ancestors: ['Parent'],
            unresolved: false,
          },
        ],
      },
      bookmarkSources: new Map([[file.path, '# Parent\n- old']]),
      saveData: vi.fn().mockResolvedValue(undefined),
    });

    await plugin.resetBookmarks(file);
    const node = findByLine(parseMarkdown(markdown, 'Note'), 2)!;

    await plugin.addBookmark(file, node, markdown);
    markdown = '# Intro\n# Parent\n- renamed';
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);

    expect(plugin.settings.bookmarks[0]).toMatchObject({
      text: 'renamed',
      unresolved: false,
    });
  });

  it('removes a bookmark when its Markdown line is deleted', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    let markdown = '# Parent\n- other';
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: {
        bookmarks: [
          {
            id: 'target',
            file: file.path,
            name: null,
            type: 'list',
            text: 'target',
            line: 1,
            ancestors: ['Parent'],
            unresolved: false,
          },
        ],
      },
      bookmarkSources: new Map([[file.path, '# Parent\n- target\n- other']]),
      saveData: vi.fn().mockResolvedValue(undefined),
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);
    expect(plugin.settings.bookmarks).toEqual([]);
  });

  it('keeps a bookmark unresolved when a complex edit cannot be tracked', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const before = '# Parent\n- target\n- other';
    const after = '# Parent\n- replacement';
    const bookmark = {
      id: 'target',
      file: file.path,
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      unresolved: false,
    };
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(after)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([[file.path, before]]),
      saveData: vi.fn().mockResolvedValue(undefined),
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    await update.call(plugin, file);

    expect(bookmark.unresolved).toBe(true);
  });

  it('resolves a bookmark when undo restores its exact node', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const original = '# Parent\n- target\n- other';
    let markdown = '# Parent\n- other';
    const bookmark = {
      id: 'target',
      file: file.path,
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      unresolved: true,
    };
    const saveData = vi.fn().mockResolvedValue(undefined);
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([[file.path, markdown]]),
      saveData,
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    markdown = original;
    await update.call(plugin, file);

    expect(bookmark.unresolved).toBe(false);
    expect(saveData).toHaveBeenCalledOnce();
  });

  it('does not resolve a missing bookmark from a matching node on another line', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    let markdown = '# Parent\n- other';
    const bookmark = {
      id: 'target',
      file: file.path,
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      unresolved: true,
    };
    const saveData = vi.fn().mockResolvedValue(undefined);
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([[file.path, markdown]]),
      saveData,
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    markdown = '# Parent\n- other\n- target';
    await update.call(plugin, file);

    expect(bookmark.unresolved).toBe(true);
    expect(saveData).not.toHaveBeenCalled();
  });

  it('restores a missing bookmark after unrelated lines shift it', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    let markdown = '# Parent\n- other';
    const bookmark = {
      id: 'target',
      file: file.path,
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      level: 0,
      marker: '-',
      checked: null,
      unresolved: true,
    };
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        vault: { cachedRead: vi.fn(() => Promise.resolve(markdown)) },
        workspace: { getLeavesOfType: () => [] },
      },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([[file.path, markdown]]),
      saveData: vi.fn().mockResolvedValue(undefined),
    });
    const update = Reflect.get(plugin, 'updateBookmarks') as (
      this: MindmapPlugin,
      file: unknown,
    ) => Promise<void>;

    markdown = '# Intro\n# Parent\n- other';
    await update.call(plugin, file);
    expect(bookmark.line).toBe(2);

    markdown = '# Intro\n# Parent\n- target\n- other';
    await update.call(plugin, file);

    expect(bookmark).toMatchObject({ line: 2, unresolved: false });
  });

  it('persists adding, renaming, removing, and resetting bookmarks', async () => {
    const file = Object.assign(new TFile(), {
      path: 'Note.md',
      basename: 'Note',
    });
    const other = Object.assign(new TFile(), {
      path: 'Other.md',
      basename: 'Other',
    });
    const saveData = vi.fn().mockResolvedValue(undefined);
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: { workspace: { getLeavesOfType: () => [] } },
      settings: { bookmarks: [] },
      bookmarkSources: new Map(),
      saveData,
    });
    const node = findByLine(parseMarkdown('- target', 'Note'), 0)!;

    await plugin.addBookmark(file, node, '- target');
    const added = plugin.settings.bookmarks[0]!;

    expect(saveData).toHaveBeenLastCalledWith(plugin.settings);
    expect(added).toMatchObject({ file: 'Note.md', text: 'target' });

    await plugin.renameBookmark(added.id, 'Important');
    expect(added.name).toBe('Important');
    expect(saveData).toHaveBeenLastCalledWith(plugin.settings);

    await plugin.addBookmark(other, node, '- target');
    await plugin.removeBookmark(added.id);
    expect(plugin.settings.bookmarks.map((bookmark) => bookmark.file)).toEqual([
      'Other.md',
    ]);
    expect(saveData).toHaveBeenLastCalledWith(plugin.settings);

    await plugin.resetBookmarks();
    expect(plugin.settings.bookmarks).toEqual([]);
    expect(saveData).toHaveBeenCalledTimes(5);
  });

  it('loads a persisted bookmark after a plugin restart', async () => {
    const stored = {
      id: 'saved',
      file: 'Note.md',
      name: 'Important',
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      marker: '-',
      checked: null,
      unresolved: false,
    };
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      loadData: vi.fn().mockResolvedValue({ bookmarks: [stored] }),
    });

    await plugin.loadSettings();

    expect(plugin.settings.bookmarks).toEqual([stored]);
  });

  it('moves bookmark paths and source revisions with a renamed folder', () => {
    const child = Object.assign(new TFile(), {
      path: 'Archive/Plans/One.md',
    });
    const folder = Object.assign(new TFolder(), {
      path: 'Archive/Plans',
      children: [child],
    });
    const bookmark = {
      id: 'saved',
      file: 'Plans/One.md',
      name: null,
      type: 'list' as const,
      text: 'target',
      line: 0,
      ancestors: [],
      unresolved: false,
    };
    const saveData = vi.fn().mockResolvedValue(undefined);
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: {
        loadLocalStorage: vi.fn(() => null),
        saveLocalStorage: vi.fn(),
      },
      settings: { bookmarks: [bookmark] },
      bookmarkSources: new Map([['Plans/One.md', '- target']]),
      saveData,
    });
    const rename = Reflect.get(plugin, 'renameStoredFile') as (
      this: MindmapPlugin,
      file: unknown,
      oldPath: string,
    ) => void;

    rename.call(plugin, folder, 'Plans');

    expect(bookmark.file).toBe('Archive/Plans/One.md');
    expect(Reflect.get(plugin, 'bookmarkSources')).toEqual(
      new Map([['Archive/Plans/One.md', '- target']]),
    );
    expect(saveData).toHaveBeenCalledWith(plugin.settings);
  });

  it('removes bookmarks and source revisions with a deleted folder', () => {
    const child = Object.assign(new TFile(), { path: 'Plans/One.md' });
    const folder = Object.assign(new TFolder(), {
      path: 'Plans',
      children: [child],
    });
    const bookmark = (id: string, file: string) => ({
      id,
      file,
      name: null,
      type: 'list' as const,
      text: id,
      line: 0,
      ancestors: [],
      unresolved: false,
    });
    const saveData = vi.fn().mockResolvedValue(undefined);
    const saveLocalStorage = vi.fn();
    const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

    Object.assign(plugin, {
      app: { saveLocalStorage },
      settings: {
        bookmarks: [
          bookmark('deleted', 'Plans/One.md'),
          bookmark('kept', 'Other.md'),
        ],
      },
      bookmarkSources: new Map([
        ['Plans/One.md', '- deleted'],
        ['Other.md', '- kept'],
      ]),
      saveData,
    });
    const remove = Reflect.get(plugin, 'deleteStoredFile') as (
      this: MindmapPlugin,
      file: unknown,
    ) => void;

    remove.call(plugin, folder);

    expect(plugin.settings.bookmarks.map((item) => item.id)).toEqual(['kept']);
    expect(Reflect.get(plugin, 'bookmarkSources')).toEqual(
      new Map([['Other.md', '- kept']]),
    );
    expect(saveLocalStorage).toHaveBeenCalledWith(
      'mindmap-editor:viewport:Plans/One.md',
      null,
    );
    expect(saveData).toHaveBeenCalledWith(plugin.settings);
  });
});
