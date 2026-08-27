import { describe, expect, it } from 'vitest';
import { clampZoom, MAX_ZOOM, MIN_ZOOM, wheelZoom } from './zoom';

describe('zoom', () => {
  it('clamps zoom to the supported range', () => {
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(4)).toBe(MAX_ZOOM);
  });

  it('matches Graph View wheel scaling when zooming in', () => {
    expect(wheelZoom(1, -1)).toBeCloseTo(1.0033845907368393);
    expect(wheelZoom(1, -100)).toBeCloseTo(1.4019828977761009);
  });

  it('matches Graph View wheel scaling when zooming out', () => {
    expect(wheelZoom(1, 100)).toBeCloseTo(0.713275462622442);
  });
});
