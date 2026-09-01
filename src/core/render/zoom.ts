export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 3;
export const ZOOM_STEP = 0.1;
const WHEEL_ZOOM_BASE = 1.0033845907368393;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Uses the same exponential wheel curve as Obsidian's Graph View. */
export function wheelZoom(zoom: number, delta: number): number {
  return clampZoom(zoom * WHEEL_ZOOM_BASE ** -delta);
}
