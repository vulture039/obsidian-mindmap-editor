import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  wheelZoom,
  ZOOM_STEP,
} from '../../core/render/zoom';

/** Empty space around the canvas, allowing it to pan beyond every edge. */
export const PAN_INSET = 2048;

interface ZoomAnchor {
  viewportX: number;
  viewportY: number;
  contentX: number;
  contentY: number;
}

interface PanStart {
  x: number;
  y: number;
  left: number;
  top: number;
}

/** Owns zoom, touch gestures, and the scrollable surface around a mind map. */
export class MapViewport {
  private zoom = 1;
  private zoomTarget = 1;
  private zoomFrame: number | null = null;
  private zoomAnchor: ZoomAnchor | null = null;
  private initialized = false;
  private zoomOutActionEl: HTMLElement | null = null;
  private zoomInActionEl: HTMLElement | null = null;
  private readonly abort = new AbortController();

  constructor(
    private readonly scrollerEl: HTMLElement,
    private readonly surfaceEl: HTMLElement,
    private readonly canvasEl: HTMLElement,
    initialZoom = 1,
  ) {
    this.zoom = clampZoom(initialZoom);
    this.zoomTarget = this.zoom;
    canvasEl.setCssStyles({
      top: `${PAN_INSET}px`,
      left: `${PAN_INSET}px`,
    });
    this.applyZoom();
    this.listen('wheel', (event) => this.onWheel(event), { passive: false });
    this.registerTouchGestures();
  }

  get value(): number {
    return this.zoom;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  bindActions(out: HTMLElement, into: HTMLElement): void {
    this.zoomOutActionEl = out;
    this.zoomInActionEl = into;
    this.syncActions();
  }

  zoomIn(): void {
    this.smoothZoom(this.zoomTarget + ZOOM_STEP);
  }

  zoomOut(): void {
    this.smoothZoom(this.zoomTarget - ZOOM_STEP);
  }

  restore(value: number): void {
    this.cancelSmoothZoom();
    this.zoom = clampZoom(value);
    this.zoomTarget = this.zoom;
    this.applyZoom();
    this.syncActions();
  }

  sizeSurface(width: number, height: number): void {
    this.surfaceEl.setCssStyles({
      width: `${width + PAN_INSET * 2}px`,
      height: `${height + PAN_INSET * 2}px`,
    });
    if (!this.initialized) {
      this.scrollerEl.scrollLeft = PAN_INSET;
      this.scrollerEl.scrollTop = PAN_INSET;
      this.initialized = true;
    }
  }

  /** Returns the transformed map to the middle without changing its zoom. */
  center(): void {
    this.cancelSmoothZoom();
    this.zoomTarget = this.zoom;
    this.scrollerEl.scrollLeft =
      this.canvasEl.offsetLeft +
      (this.canvasEl.offsetWidth * this.zoom - this.scrollerEl.clientWidth) / 2;
    this.scrollerEl.scrollTop =
      this.canvasEl.offsetTop +
      (this.canvasEl.offsetHeight * this.zoom - this.scrollerEl.clientHeight) /
        2;
    this.syncActions();
  }

  destroy(): void {
    this.cancelSmoothZoom();
    this.abort.abort();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void {
    this.scrollerEl.addEventListener(type, listener, {
      ...options,
      signal: this.abort.signal,
    });
  }

  /** Keeps the toolbar's accessible labels and limit states in sync. */
  private syncActions(): void {
    const percent = Math.round(this.zoom * 100);
    const atMinimum = this.zoom <= MIN_ZOOM;
    const atMaximum = this.zoom >= MAX_ZOOM;

    this.zoomOutActionEl?.setAttribute('aria-label', `Zoom out (${percent}%)`);
    this.zoomInActionEl?.setAttribute('aria-label', `Zoom in (${percent}%)`);
    this.zoomOutActionEl?.toggleClass('is-disabled', atMinimum);
    this.zoomInActionEl?.toggleClass('is-disabled', atMaximum);
    this.zoomOutActionEl?.setAttribute('aria-disabled', String(atMinimum));
    this.zoomInActionEl?.setAttribute('aria-disabled', String(atMaximum));
  }

  /** Moves toward a target over several frames, like Obsidian's Graph View. */
  private smoothZoom(next: number, clientX?: number, clientY?: number): void {
    this.zoomTarget = clampZoom(next);
    if (Math.abs(this.zoomTarget - this.zoom) < 0.001) {
      this.cancelSmoothZoom();
      this.syncActions();

      return;
    }
    this.zoomAnchor = this.captureZoomAnchor(clientX, clientY);
    if (this.zoomFrame === null) {
      this.zoomFrame = this.canvasEl.win.requestAnimationFrame(() =>
        this.stepSmoothZoom(),
      );
    }
  }

  private stepSmoothZoom(): void {
    const distance = this.zoomTarget - this.zoom;
    const done = Math.abs(distance) < 0.001;
    const next = done ? this.zoomTarget : this.zoom + distance * 0.28;

    this.zoomFrame = null;
    if (this.zoomAnchor) {
      this.applyZoomAtAnchor(next, this.zoomAnchor);
    }
    if (done) {
      this.zoomAnchor = null;
      this.syncActions();
    } else {
      this.zoomFrame = this.canvasEl.win.requestAnimationFrame(() =>
        this.stepSmoothZoom(),
      );
    }
  }

  private cancelSmoothZoom(): void {
    if (this.zoomFrame !== null) {
      this.canvasEl.win.cancelAnimationFrame(this.zoomFrame);
      this.zoomFrame = null;
    }
    this.zoomAnchor = null;
  }

  /** Applies a zoom while keeping the chosen point fixed in the viewport. */
  private setZoom(next: number, clientX?: number, clientY?: number): void {
    const zoom = clampZoom(next);

    this.cancelSmoothZoom();
    this.zoomTarget = zoom;
    this.applyZoomAt(zoom, clientX, clientY);
    this.syncActions();
  }

  private applyZoomAt(zoom: number, clientX?: number, clientY?: number): void {
    if (Math.abs(zoom - this.zoom) < 0.0001) {
      return;
    }
    this.applyZoomAtAnchor(zoom, this.captureZoomAnchor(clientX, clientY));
  }

  private captureZoomAnchor(clientX?: number, clientY?: number): ZoomAnchor {
    const box = this.scrollerEl.getBoundingClientRect();
    const viewportX = (clientX ?? box.left + box.width / 2) - box.left;
    const viewportY = (clientY ?? box.top + box.height / 2) - box.top;

    return {
      viewportX,
      viewportY,
      contentX:
        (this.scrollerEl.scrollLeft + viewportX - PAN_INSET) / this.zoom,
      contentY: (this.scrollerEl.scrollTop + viewportY - PAN_INSET) / this.zoom,
    };
  }

  private applyZoomAtAnchor(zoom: number, anchor: ZoomAnchor): void {
    if (Math.abs(zoom - this.zoom) < 0.0001) {
      return;
    }
    this.zoom = zoom;
    this.applyZoom();
    this.scrollerEl.scrollLeft =
      PAN_INSET + anchor.contentX * zoom - anchor.viewportX;
    this.scrollerEl.scrollTop =
      PAN_INSET + anchor.contentY * zoom - anchor.viewportY;
  }

  private applyZoom(): void {
    // Transform stays on Chromium's compositor; the fixed-size surface owns
    // scroll bounds, so zooming does not re-layout every node each frame.
    this.canvasEl.style.setProperty('transform', `scale(${this.zoom})`);
  }

  private onWheel(event: WheelEvent): void {
    if (!event.deltaY) {
      return;
    }
    event.preventDefault();
    this.smoothZoom(
      wheelZoom(this.zoomTarget, event.deltaY),
      event.clientX,
      event.clientY,
    );
  }

  /** One-finger background pan and two-finger, midpoint-anchored zoom. */
  private registerTouchGestures(): void {
    let pan: PanStart | null = null;
    let pinch: { distance: number; zoom: number } | null = null;
    const distance = (touches: TouchList): number =>
      Math.hypot(
        touches[0]!.clientX - touches[1]!.clientX,
        touches[0]!.clientY - touches[1]!.clientY,
      );

    this.listen(
      'touchstart',
      (event) => {
        if (event.touches.length === 2) {
          const startDistance = distance(event.touches);

          if (!startDistance) {
            return;
          }
          this.cancelSmoothZoom();
          this.zoomTarget = this.zoom;
          pinch = { distance: startDistance, zoom: this.zoom };
          pan = null;
          event.preventDefault();
        } else if (
          event.touches.length === 1 &&
          !(event.target as Element | null)?.closest('.mindmap-node')
        ) {
          const touch = event.touches[0]!;

          pan = this.panStart(touch);
        }
      },
      { passive: false },
    );
    this.listen(
      'touchmove',
      (event) => {
        if (event.touches.length === 2 && pinch) {
          const first = event.touches[0]!;
          const second = event.touches[1]!;

          event.preventDefault();
          this.setZoom(
            pinch.zoom * (distance(event.touches) / pinch.distance),
            (first.clientX + second.clientX) / 2,
            (first.clientY + second.clientY) / 2,
          );
        } else if (event.touches.length === 1 && pan) {
          const touch = event.touches[0]!;

          event.preventDefault();
          this.scrollerEl.scrollLeft = pan.left - (touch.clientX - pan.x);
          this.scrollerEl.scrollTop = pan.top - (touch.clientY - pan.y);
        }
      },
      { passive: false },
    );
    const end = (event: TouchEvent): void => {
      if (event.touches.length < 2) {
        pinch = null;
      }
      if (event.touches.length === 1) {
        pan = this.panStart(event.touches[0]!);
      } else if (event.touches.length === 0) {
        pan = null;
      }
    };

    this.listen('touchend', end);
    this.listen('touchcancel', end);
  }

  private panStart(touch: Touch): PanStart {
    return {
      x: touch.clientX,
      y: touch.clientY,
      left: this.scrollerEl.scrollLeft,
      top: this.scrollerEl.scrollTop,
    };
  }
}
