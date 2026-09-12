import { clampZoom } from './zoom';

export interface ViewportState {
  zoom: number;
  left: number;
  top: number;
}

export function readViewportState(value: unknown): ViewportState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const state = value as ViewportState;
  const valid =
    [state.zoom, state.left, state.top].every(
      (part) => typeof part === 'number' && Number.isFinite(part),
    ) &&
    state.zoom > 0 &&
    state.left >= 0 &&
    state.top >= 0;

  if (!valid) {
    return null;
  }

  return { zoom: clampZoom(state.zoom), left: state.left, top: state.top };
}
