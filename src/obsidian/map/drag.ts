import { MindNode } from '../../core/parse/parser';
import { LaidNode } from '../../core/render/layout';
import {
  canDrop,
  canDropAsSibling,
  DropTarget,
  findDrop,
} from '../../core/render/drag';

/** Pointer travel (px) before a press on a node turns into a drag. */
const DRAG_START_THRESHOLD = 6;

/** The node being dragged; the view watches for it to spot a stuck drag. */
export const DRAGGING_SELECTOR = '.mindmap-node.is-dragging';

/** Gap (px) between the dragged node's insertion bar and the anchor node. */
const INDICATOR_GAP = 4;

/** What a drag needs from the view it runs in. */
export interface DragHost {
  canvasEl: HTMLElement;
  /** The nodes currently on the canvas, the drop targets among them. */
  nodes: Map<number, LaidNode>;
  /** True while an inline edit owns the pointer; no drag may start. */
  isEditing(): boolean;
  setDragging(dragging: boolean): void;
  sources(source: MindNode): MindNode[];
  drop(sources: MindNode[], target: MindNode, before: MindNode | null): void;
  /** Runs the render a drag held off, if one is waiting. */
  settle(): void;
}

/**
 * Makes `el` draggable onto the other nodes. Where it may land is
 * core/render/drag's answer; this is the pointer handling around it.
 */
export function setupNodeDrag(
  host: DragHost,
  node: MindNode,
  el: HTMLElement,
): void {
  if (node.type === 'root') {
    return;
  }
  el.addClass('is-draggable');
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || host.isEditing()) {
      return;
    }
    if (e.target instanceof HTMLInputElement) {
      return;
    }
    e.stopPropagation();
    runDrag(host, node, el, e);
  });
}

function runDrag(
  host: DragHost,
  node: MindNode,
  el: HTMLElement,
  down: PointerEvent,
): void {
  const sources = host.sources(node);
  const doc = el.doc;
  const pointerId = down.pointerId;
  let started = false;
  let finished = false;
  let indicator: HTMLElement | null = null;
  let drop: DropTarget | null = null;
  const clearCues = (): void => {
    drop?.laid.el.removeClass('is-drop-target', 'is-shift-down', 'is-shift-up');
    indicator?.hide();
  };
  const applyCues = (): void => {
    if (!drop) {
      return;
    }
    const laid = drop.laid;

    if (!drop.parent) {
      laid.el.addClass('is-drop-target');

      return;
    }
    // Sibling slot: nudge the anchor node aside and show an insertion bar in
    // the gap the drop would fill.
    const above = drop.before === laid.node;

    laid.el.addClass(above ? 'is-shift-down' : 'is-shift-up');
    indicator ??= host.canvasEl.createDiv({ cls: 'mindmap-drop-indicator' });
    indicator.show();
    indicator.setCssStyles({
      left: `${laid.x}px`,
      width: `${laid.w}px`,
      top: `${
        above ? laid.y - 2 * INDICATOR_GAP : laid.y + laid.h + INDICATOR_GAP
      }px`,
    });
  };
  const begin = (): void => {
    started = true;
    host.setDragging(true);
    // Capture the pointer so pointerup still arrives when the button is
    // released outside the window. A missed pointerup leaves the drag flag
    // stuck, which blocks every re-render and desyncs the map.
    try {
      el.setPointerCapture(pointerId);
    } catch {
      // Pointer already gone; the doc listeners still cover the normal
      // in-window case.
    }
    el.addClass('is-dragging');
    host.canvasEl.addClass('is-drag-active');
    for (const laid of host.nodes.values()) {
      const target = laid.node;

      if (
        laid.el !== el &&
        !sources.every((source) => canDrop(source, target)) &&
        !sources.every((source) => canDropAsSibling(source, target))
      ) {
        laid.el.addClass('is-invalid-target');
      }
    }
  };
  const onMove = (ev: PointerEvent): void => {
    const traveled =
      Math.abs(ev.clientX - down.clientX) + Math.abs(ev.clientY - down.clientY);

    if (!started) {
      if (traveled < DRAG_START_THRESHOLD) {
        return;
      }
      begin();
    }
    const next = findDrop(host.nodes, sources, ev.clientX, ev.clientY);

    if (!sameDrop(drop, next)) {
      clearCues();
      drop = next;
      applyCues();
    }
  };
  const finish = (apply: boolean): void => {
    if (finished) {
      return;
    }
    finished = true;
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onCancel);
    el.removeEventListener('lostpointercapture', onCancel);
    try {
      if (el.hasPointerCapture(pointerId)) {
        el.releasePointerCapture(pointerId);
      }
    } catch {
      // Capture already released; nothing to clean up.
    }
    el.removeClass('is-dragging');
    host.canvasEl.removeClass('is-drag-active');
    host.canvasEl
      .querySelectorAll('.mindmap-node.is-invalid-target')
      .forEach((marked) => marked.removeClass('is-invalid-target'));
    const finalDrop = drop;

    clearCues();
    indicator?.remove();
    host.setDragging(false);
    if (!started) {
      host.settle();

      return;
    }
    suppressNextClick(el, doc);
    if (apply && finalDrop) {
      host.drop(
        sources,
        finalDrop.parent ?? finalDrop.laid.node,
        finalDrop.parent ? finalDrop.before : null,
      );

      return;
    }
    host.settle();
  };
  const onUp = (): void => finish(true);
  const onCancel = (): void => finish(false);

  doc.addEventListener('pointermove', onMove);
  doc.addEventListener('pointerup', onUp);
  doc.addEventListener('pointercancel', onCancel);
  // Fires if the node element is torn down mid-drag (e.g. the leaf is
  // detached); ends the drag instead of leaving it stuck.
  el.addEventListener('lostpointercapture', onCancel);
}

function sameDrop(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) {
    return true;
  }

  return (
    !!a &&
    !!b &&
    a.laid === b.laid &&
    a.parent === b.parent &&
    a.before === b.before
  );
}

/**
 * A pointerup that ended a drag still generates a click; swallow it, or it
 * selects a node or opens a link under the cursor.
 */
function suppressNextClick(el: HTMLElement, doc: Document): void {
  const suppress = (ce: MouseEvent): void => {
    ce.stopPropagation();
    ce.preventDefault();
  };

  doc.addEventListener('click', suppress, true);
  el.win.setTimeout(() => doc.removeEventListener('click', suppress, true), 0);
}
