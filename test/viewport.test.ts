// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { MapViewport } from '../src/obsidian/map/viewport';
import { readViewportState } from '../src/core/render/viewport-state';
import { installObsidianDom } from './stubs/obsidian-dom';

installObsidianDom();
Object.assign(HTMLElement.prototype, {
  setCssStyles(this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
    Object.assign(this.style, styles);
  },
});

function open() {
  const scroller = document.createElement('div');
  const surface = scroller.appendChild(document.createElement('div'));
  const canvas = surface.appendChild(document.createElement('div'));
  const viewport = new MapViewport(scroller, surface, canvas);

  viewport.sizeSurface(4000, 3000);

  return { viewport, scroller, canvas };
}

describe('remembered viewport', () => {
  it('restores zoom and both positions in a new viewport after layout', () => {
    const first = open();

    first.viewport.restore(1.4);
    first.scroller.scrollLeft = 2345;
    first.scroller.scrollTop = 2678;
    const stored: unknown = JSON.parse(
      JSON.stringify(first.viewport.snapshot()),
    );

    first.viewport.destroy();
    const second = open();
    const state = readViewportState(stored)!;

    second.viewport.restorePosition(state);
    second.viewport.sizeSurface(5000, 4000);
    expect(second.viewport.snapshot()).toEqual(state);
    expect(second.canvas.style.transform).toBe('scale(1.4)');
    second.viewport.destroy();
  });

  it('centers a node by scrolling only the map viewport', () => {
    const { viewport, scroller, canvas } = open();
    const node = canvas.appendChild(document.createElement('div'));

    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 400, 300),
    );
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(350, 280, 100, 40),
    );
    viewport.centerElement(node);

    expect(scroller.scrollLeft).toBe(2148);
    expect(scroller.scrollTop).toBe(2098);
    viewport.destroy();
  });

  it.each([
    null,
    {},
    { zoom: 0, left: 1, top: 2 },
    { zoom: 1, left: -1, top: 2 },
    { zoom: 1, left: 1, top: Infinity },
    { zoom: '1', left: 1, top: 2 },
  ])('ignores invalid stored data: %j', (value) => {
    expect(readViewportState(value)).toBeNull();
  });
});
