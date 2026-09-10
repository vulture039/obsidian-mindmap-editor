import { describe, expect, it, vi } from 'vitest';
import MindmapPlugin from '../src/main';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Plugin: class {},
}));
vi.mock('../src/obsidian/settings', () => ({ MindmapSettingTab: class {} }));
vi.mock('../src/obsidian/map/mindmap-view', () => ({
  MindmapView: class {},
  VIEW_TYPE_MINDMAP: 'mindmap-editor',
}));

function setup(sharedParent: boolean, mobile = false) {
  const source = { parent: {} };
  const state = {
    type: 'mindmap-editor',
    state: { file: 'Note.md', viewport: { zoom: 0.8, left: 2300, top: 2400 } },
    pinned: true,
  };
  const previous = {
    parent: sharedParent ? source.parent : {},
    group: 'linked-group',
    getViewState: () => state,
    getEphemeralState: () => ({
      selection: 12,
      viewport: { zoom: 1.25, left: 2316, top: 2300 },
    }),
    detach: vi.fn(),
  };
  const split = {
    parent: {},
    setViewState: vi.fn().mockResolvedValue(undefined),
    setEphemeralState: vi.fn(),
    setGroup: vi.fn(),
    detach: vi.fn(),
  };
  const revealLeaf = vi.fn();
  const openSplit = vi.fn(() => split);
  const plugin = Object.create(MindmapPlugin.prototype) as MindmapPlugin;

  Object.assign(plugin, {
    app: {
      workspace: {
        getActiveFile: () => ({ path: 'Note.md', extension: 'md' }),
        getLeaf: () => source,
        revealLeaf,
        createLeafBySplit: openSplit,
      },
    },
    settings: { splitDirection: 'vertical' },
    paneFor: () => source,
    mapLeaves: () => [previous],
    openSplit,
  });
  Object.defineProperty(plugin, 'isMobile', { value: mobile });
  // Both leaves belong to the same window.
  const container = {};

  Object.assign(source, { getContainer: () => container });
  Object.assign(previous, { getContainer: () => container });
  const open = Reflect.get(plugin, 'openMindmap') as () => Promise<void>;

  return {
    open: () => open.call(plugin),
    previous,
    split,
    state,
    revealLeaf,
    openSplit,
  };
}

describe('opening the active map', () => {
  it('replaces a same-group tab with a split while preserving its state', async () => {
    const test = setup(true);

    await test.open();
    expect(test.split.setViewState).toHaveBeenCalledWith(test.state);
    expect(test.split.setGroup).toHaveBeenCalledWith('linked-group');
    expect(test.split.setEphemeralState).toHaveBeenCalledWith({
      selection: 12,
      viewport: { zoom: 1.25, left: 2316, top: 2300 },
    });
    expect(test.previous.detach).toHaveBeenCalledOnce();
    expect(test.revealLeaf).toHaveBeenCalledWith(test.split);
  });

  it.each([
    [false, false],
    [true, true],
  ])(
    'preserves existing split or mobile reuse (shared=%s, mobile=%s)',
    async (shared, mobile) => {
      const test = setup(shared, mobile);

      await test.open();
      expect(test.openSplit).not.toHaveBeenCalled();
      expect(test.previous.detach).not.toHaveBeenCalled();
      expect(test.revealLeaf).toHaveBeenCalledWith(test.previous);
    },
  );

  it('keeps the original tab if preparing the split fails', async () => {
    const test = setup(true);

    test.split.setViewState.mockRejectedValue(new Error('failed to open'));
    await expect(test.open()).rejects.toThrow('failed to open');
    expect(test.previous.detach).not.toHaveBeenCalled();
    expect(test.split.detach).toHaveBeenCalledOnce();
  });
});
