// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MindmapView } from '../src/obsidian/map/mindmap-view';
import { TFile } from 'obsidian';
import { MapViewport } from '../src/obsidian/map/viewport';
import type { ViewportState } from '../src/core/render/viewport-state';
import { installObsidianDom } from './stubs/obsidian-dom';

vi.mock('obsidian', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ItemView: class {
    async setState(): Promise<void> {}
    getEphemeralState(): Record<string, unknown> {
      return { inherited: true };
    }
    setEphemeralState(): void {}
  },
  TFile: class {},
}));

installObsidianDom();
Object.assign(HTMLElement.prototype, {
  setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  },
});

function open() {
  const scroller = document.createElement('div');

  scroller.setCssStyles({ overflowX: 'auto', overflowY: 'auto' });
  document.body.appendChild(scroller);
  const surface = scroller.appendChild(document.createElement('div'));
  const canvas = surface.appendChild(document.createElement('div'));
  const viewport = new MapViewport(scroller, surface, canvas);
  const fit = vi.fn();
  const focusInitialCursor = vi.fn(() => false);
  // Exercise view-state and reveal methods with the host/layout supplied.
  const view = Object.create(MindmapView.prototype) as MindmapView;

  Object.assign(view, {
    file: null,
    plugin: { isAutoOpenFile: vi.fn(() => true) },
    viewport,
    scrollerEl: scroller,
    viewportReady: true,
    hasRestoredViewport: false,
    lastViewport: null,
    savedZoom: 1,
    renderQueued: false,
    renderSeq: 1,
    layoutBuildSeq: null,
    revealTimer: null,
    laidRoot: {},
    contentEl: { offsetHeight: 600 },
    containerEl: { win: window },
    syncToggleActions: vi.fn(),
    saveViewport: vi.fn(),
    fit,
    focusInitialCursor,
  });

  viewport.sizeSurface(4000, 3000);

  return { view, viewport, scroller, fit, focusInitialCursor };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('view-state restoration', () => {
  it('keeps the canvas hidden until a saved position can be applied', async () => {
    const { view, viewport, scroller } = open();
    const position = { zoom: 1.4, left: 2300, top: 2400 };

    Object.assign(view, { layoutBuildSeq: 2 });
    await view.setState({ viewport: position }, { history: false });
    expect(scroller.classList.contains('is-positioning')).toBe(true);

    Object.assign(view, { layoutBuildSeq: null });
    const schedule = Reflect.get(view, 'schedulePendingReveal') as () => void;

    schedule.call(view);
    vi.advanceTimersByTime(95);
    expect(scroller.classList.contains('is-positioning')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(viewport.snapshot()).toEqual(position);
    expect(scroller.classList.contains('is-positioning')).toBe(false);

    scroller.scrollLeft = 2400;
    scroller.scrollTop = 2500;
    vi.advanceTimersByTime(500);
    expect(viewport.snapshot()).toEqual({ zoom: 1.4, left: 2400, top: 2500 });
    viewport.destroy();
  });

  it('frames once after resizing settles', () => {
    const { view, viewport, scroller, fit } = open();

    view.initialViewportAfterReveal(null);
    vi.advanceTimersByTime(31);
    expect(fit).not.toHaveBeenCalled();
    view.onResize();
    vi.advanceTimersByTime(95);
    expect(fit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(scroller.classList.contains('is-positioning')).toBe(false);

    vi.advanceTimersByTime(500);
    expect(fit).toHaveBeenCalledTimes(1);
    viewport.destroy();
  });

  it.each([null, 32])(
    'restores a saved position for an unbookmarked opening (cursor %s)',
    async (cursor) => {
      const { view, viewport, fit, focusInitialCursor } = open();

      Object.assign(view, {
        plugin: { isAutoOpenFile: () => false },
        app: { vault: { getAbstractFileByPath: vi.fn(() => null) } },
      });
      focusInitialCursor.mockReturnValue(cursor !== null);
      await view.setState(
        {
          file: 'New.md',
          zoom: 0.8,
          viewport: { zoom: 0.8, left: 2300, top: 2400 },
        },
        { history: false },
      );
      view.initialViewportAfterReveal(cursor);
      vi.advanceTimersByTime(500);
      expect(focusInitialCursor).not.toHaveBeenCalled();
      expect(fit).not.toHaveBeenCalled();
      expect(view.getState().viewport).toEqual({
        zoom: 0.8,
        left: 2300,
        top: 2400,
      });
      expect(viewport.value).toBe(0.8);
      viewport.destroy();
    },
  );

  it('frames a file with no saved position at 100%', async () => {
    const { view, viewport } = open();

    viewport.restore(0.65);
    Object.assign(view, {
      file: Object.assign(new TFile(), { path: 'Saved.md' }),
      plugin: { isAutoOpenFile: () => false },
      app: { loadLocalStorage: vi.fn(() => null) },
      persistViewport: { cancel: vi.fn() },
      selectOnly: vi.fn(),
      expandedDone: new Set(),
      collapsedBranches: new Set(),
      foldedText: new Set(),
      render: vi.fn(),
      loadStoredCollapse: vi.fn(),
      leaf: {},
    });
    await view.setFile(Object.assign(new TFile(), { path: 'Ordinary.md' }));
    expect(viewport.value).toBe(1);
    viewport.destroy();
  });

  it('transfers and serializes a live unbookmarked viewport', () => {
    const first = open();
    const position = { zoom: 1.25, left: 2316, top: 2300 };

    Object.assign(first.view, { plugin: { isAutoOpenFile: () => false } });
    first.viewport.restorePosition(position);
    const ephemeral = first.view.getEphemeralState();

    expect(ephemeral).toEqual({ inherited: true, viewport: position });
    expect(first.view.getState().viewport).toEqual(position);
    const moved = open();

    Object.assign(moved.view, { plugin: { isAutoOpenFile: () => false } });
    moved.view.setEphemeralState(ephemeral);
    vi.advanceTimersByTime(500);
    expect(moved.viewport.snapshot()).toEqual(position);
    expect(moved.view.getState().viewport).toEqual(position);
    first.viewport.destroy();
    moved.viewport.destroy();
  });

  it('preserves the last scroll position when plugin CSS is removed before closing', async () => {
    const { view, viewport, scroller } = open();
    const position = { zoom: 0.8, left: 2300, top: 2400 };
    const saveLocalStorage = vi.fn();

    viewport.restorePosition(position);
    expect(view.getState().viewport).toEqual(position);
    // CSS removal resets scroll offsets while the pane itself remains visible.
    scroller.setCssStyles({ overflowX: 'visible', overflowY: 'visible' });
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    expect(view.getState().viewport).toEqual(position);
    Reflect.deleteProperty(view, 'saveViewport');
    Object.assign(view, {
      file: { path: 'Note.md' },
      app: { saveLocalStorage, workspace: { requestSaveLayout: vi.fn() } },
      persistViewport: { cancel: vi.fn() },
      finishRenderStaging: vi.fn(),
    });
    await view.onClose();
    expect(saveLocalStorage).toHaveBeenCalledWith(
      'mindmap-editor:viewport:Note.md',
      position,
    );
  });

  it('defers a render when the tab becomes hidden during its file read', async () => {
    const { view, viewport } = open();
    let finishRead!: (text: string) => void;
    const empty = vi.fn();

    Object.assign(view, {
      file: { path: 'Note.md' },
      isBusy: () => false,
      getFileText: () =>
        new Promise<string>((resolve) => {
          finishRead = resolve;
        }),
      canvasEl: { empty },
    });
    const render = Reflect.get(view, 'render') as () => Promise<void>;
    const rendering = render.call(view);

    Object.defineProperty(view.contentEl, 'offsetHeight', { value: 0 });
    finishRead('# Note');
    await rendering;
    expect(Reflect.get(view, 'renderQueued')).toBe(true);
    expect(empty).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it('does not capture intermediate scroll offsets during initial framing', () => {
    const { view, viewport, scroller } = open();

    Object.assign(view, {
      revealPending: { kind: 'initial', cursorLine: null },
    });
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    expect(view.getState().viewport).toBeNull();
    viewport.destroy();
  });

  it.each([false, true])(
    'frames an unsaved file after setFile, including a hidden pane (%s)',
    async (hidden) => {
      const { view, viewport, fit } = open();

      Object.assign(view, {
        app: { loadLocalStorage: vi.fn(() => null) },
        persistViewport: { cancel: vi.fn() },
        selectOnly: vi.fn(),
        expandedDone: new Set(),
        collapsedBranches: new Set(),
        foldedText: new Set(),
        render: vi.fn(),
        loadStoredCollapse: vi.fn(),
        leaf: {},
      });
      Object.defineProperty(view.contentEl, 'offsetHeight', {
        value: hidden ? 0 : 600,
        configurable: true,
      });
      await view.setFile(Object.assign(new TFile(), { path: 'New.md' }));
      view.onResize();
      if (hidden) {
        expect(fit).not.toHaveBeenCalled();
        Object.defineProperty(view.contentEl, 'offsetHeight', { value: 600 });
        view.onResize();
      }
      vi.advanceTimersByTime(500);
      expect(fit).toHaveBeenCalled();
      viewport.destroy();
    },
  );

  it('honors explicit zoom updates through getState/setState', async () => {
    const { view, viewport, fit } = open();

    await view.setState({ ...view.getState(), zoom: 0.65 }, { history: false });
    expect(viewport.value).toBe(0.65);
    vi.advanceTimersByTime(400);
    expect(viewport.value).toBe(0.65);
    expect(fit).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it('honors explicit live zoom updates for an unbookmarked map', async () => {
    const { view, viewport } = open();

    Object.assign(view, {
      file: Object.assign(new TFile(), { path: 'Ordinary.md' }),
      plugin: { isAutoOpenFile: () => false },
      app: { vault: { getAbstractFileByPath: vi.fn(() => null) } },
    });
    await view.setState({ ...view.getState(), zoom: 0.65 }, { history: false });
    expect(viewport.value).toBe(0.65);
    expect(view.getState().viewport).toMatchObject({ zoom: 0.65 });
    viewport.destroy();
  });

  it('keeps a restored position when opening resumes after the reveal timer', async () => {
    const { view, viewport, fit, focusInitialCursor } = open();
    const position = { zoom: 1.4, left: 2345, top: 2678 };

    await view.setState({ viewport: position }, { history: false });
    vi.advanceTimersByTime(500);
    view.initialViewportAfterReveal(32);
    vi.advanceTimersByTime(500);
    expect(viewport.snapshot()).toEqual(position);
    expect(fit).not.toHaveBeenCalled();
    expect(focusInitialCursor).not.toHaveBeenCalled();
    viewport.destroy();
  });

  it('allows a subsequent history state to restore another position', async () => {
    const { view, viewport } = open();

    await view.setState(
      { viewport: { zoom: 1.4, left: 2300, top: 2400 } },
      { history: false },
    );
    vi.advanceTimersByTime(500);
    const next = { zoom: 0.8, left: 2500, top: 2600 };

    await view.setState({ viewport: next }, { history: false });
    vi.advanceTimersByTime(500);
    expect(viewport.snapshot()).toEqual(next);
    viewport.destroy();
  });

  it('serializes the last visible position while the tab is hidden', async () => {
    const first = open();
    const position = { zoom: 1.4, left: 2345, top: 2678 };

    await first.view.setState({ viewport: position }, { history: false });
    vi.advanceTimersByTime(500);
    Object.defineProperty(first.view.contentEl, 'offsetHeight', { value: 0 });
    // Match Chromium's scroll getters for display:none; jsdom retains offsets.
    first.scroller.scrollLeft = 0;
    first.scroller.scrollTop = 0;
    const state = first.view.getState();

    expect(state.viewport).toEqual(position);
    const reopened = open();

    await reopened.view.setState(state, { history: false });
    vi.advanceTimersByTime(500);
    expect(reopened.viewport.snapshot()).toEqual(position);
    first.viewport.destroy();
    reopened.viewport.destroy();
  });

  it('preserves pending restoration when a tab has never been visible', () => {
    const { view, viewport } = open();
    const position = { zoom: 1.4, left: 2345, top: 2678 };

    Object.assign(view, {
      viewportReady: false,
      revealPending: { kind: 'restore', position },
    });
    Object.defineProperty(view.contentEl, 'offsetHeight', { value: 0 });
    expect(view.getState()).toMatchObject({ zoom: 1.4, viewport: position });
    viewport.destroy();
  });

  it('saves the newest hidden state and restores it when reopened', async () => {
    const { view, scroller } = open();
    const previous = { zoom: 1.4, left: 2300, top: 2400 };
    const next = { zoom: 0.8, left: 2500, top: 2600 };
    const saveLocalStorage =
      vi.fn<(key: string, value: ViewportState) => void>();

    await view.setState({ viewport: previous }, { history: false });
    vi.advanceTimersByTime(500);
    Object.defineProperty(view.contentEl, 'offsetHeight', { value: 0 });
    scroller.scrollLeft = 0;
    scroller.scrollTop = 0;
    await view.setState({ viewport: next }, { history: false });
    expect(view.getState()).toMatchObject({ zoom: next.zoom, viewport: next });

    Reflect.deleteProperty(view, 'saveViewport');
    Object.assign(view, {
      file: { path: 'Fixtures.md' },
      app: { saveLocalStorage, workspace: { requestSaveLayout: vi.fn() } },
      persistViewport: { cancel: vi.fn() },
      finishRenderStaging: vi.fn(),
    });
    await view.onClose();
    expect(saveLocalStorage).toHaveBeenCalledWith(
      'mindmap-editor:viewport:Fixtures.md',
      next,
    );
    const reopened = open();

    await reopened.view.setState(
      { viewport: saveLocalStorage.mock.calls[0]![1] },
      { history: false },
    );
    vi.advanceTimersByTime(500);
    expect(reopened.viewport.snapshot()).toEqual(next);
    reopened.viewport.destroy();
  });

  it('still frames a new map with no saved position', () => {
    const { view, viewport, fit, focusInitialCursor } = open();

    // A file with no saved viewport frames exactly like an active map.
    viewport.restore(0.65);
    view.initialViewportAfterReveal(32);
    vi.advanceTimersByTime(500);
    expect(focusInitialCursor).toHaveBeenCalledWith(32);
    expect(fit).toHaveBeenCalled();
    expect(viewport.value).toBe(1);
    viewport.destroy();
  });
});
