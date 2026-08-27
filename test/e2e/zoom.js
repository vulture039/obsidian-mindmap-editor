/** Zoom belongs to one live pane: its header, wheel and touch events, and view state. */
const scroller = el.querySelector('.mindmap-scroller');
const canvas = el.querySelector('.mindmap-canvas');
const action = (prefix) =>
  [...view.containerEl.querySelectorAll('.view-action')].find((button) =>
    button.getAttribute('aria-label')?.startsWith(prefix),
  );
const originalZoom = view.getState().zoom;
const zoom = () => view.getState().zoom;
const zoomTarget = () => view.viewport.zoomTarget;
const setZoom = async (zoom) => {
  await view.setState({ ...view.getState(), zoom }, {});
};

if (
  !scroller ||
  !canvas ||
  !action('Center mind map') ||
  !action('Zoom in') ||
  !action('Zoom out')
) {
  return fail('the map has no zoom canvas or header controls');
}

try {
  await setZoom(1);
  click(action('Zoom in'));
  await until(() => view.getState().zoom > 1);
  check(
    'the header buttons smoothly change the canvas zoom',
    zoomTarget() === 1.1 &&
      zoom() > 1 &&
      zoom() <= zoomTarget() &&
      canvas.style.transform === `scale(${zoom()})`,
    `state ${zoom()}, target ${zoomTarget()}, CSS ${canvas.style.transform}`,
  );

  await setZoom(1);
  const box = scroller.getBoundingClientRect();
  const clientX = box.left + box.width * 0.45;
  const clientY = box.top + box.height * 0.45;

  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  const anchorX =
    (scroller.scrollLeft + clientX - box.left - canvas.offsetLeft) / zoom();
  const anchorY =
    (scroller.scrollTop + clientY - box.top - canvas.offsetTop) / zoom();
  const wheel = new WheelEvent('wheel', {
    deltaY: -100,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  });

  scroller.dispatchEvent(wheel);
  await until(() => view.getState().zoom > 1);
  check(
    'the mouse wheel responds quickly without scrolling the page',
    Math.abs(zoomTarget() - 1.4019828977761009) < 0.000001 &&
      zoom() >= 1.11 &&
      zoom() <= zoomTarget() &&
      wheel.defaultPrevented,
    `zoom ${zoom()}, target ${zoomTarget()}, prevented ${wheel.defaultPrevented}`,
  );
  const afterX =
    (scroller.scrollLeft + clientX - box.left - canvas.offsetLeft) / zoom();
  const afterY =
    (scroller.scrollTop + clientY - box.top - canvas.offsetTop) / zoom();

  check(
    'wheel zoom keeps the canvas point under the cursor fixed',
    Math.abs(afterX - anchorX) < 1 && Math.abs(afterY - anchorY) < 1,
    `drift ${Math.abs(afterX - anchorX).toFixed(2)}px, ${Math.abs(afterY - anchorY).toFixed(2)}px`,
  );

  await setZoom(1.5);
  scroller.scrollLeft = (scroller.scrollWidth - scroller.clientWidth) / 2;
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  const outAnchorX =
    (scroller.scrollLeft + clientX - box.left - canvas.offsetLeft) / zoom();
  const outAnchorY =
    (scroller.scrollTop + clientY - box.top - canvas.offsetTop) / zoom();

  scroller.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: 100,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true,
    }),
  );
  await until(() => view.getState().zoom < 1.5);
  const outAfterX =
    (scroller.scrollLeft + clientX - box.left - canvas.offsetLeft) / zoom();
  const outAfterY =
    (scroller.scrollTop + clientY - box.top - canvas.offsetTop) / zoom();

  check(
    'wheel zoom out responds quickly and keeps the cursor point fixed',
    Math.abs(zoomTarget() - 1.069913193933663) < 0.000001 &&
      zoom() <= 1.38 &&
      Math.abs(outAfterX - outAnchorX) < 1 &&
      Math.abs(outAfterY - outAnchorY) < 1,
    `zoom ${zoom()}, drift ${Math.abs(outAfterX - outAnchorX).toFixed(2)}px, ${Math.abs(outAfterY - outAnchorY).toFixed(2)}px`,
  );

  await setZoom(99);
  const high = view.getState().zoom;

  await setZoom(-1);
  check(
    'zoom is clamped from 25% to 300%',
    high === 3 && view.getState().zoom === 0.25,
    `high ${high}, low ${view.getState().zoom}`,
  );

  await setZoom(0.65);
  check(
    'the pane state restores its zoom level',
    view.getState().zoom === 0.65 && canvas.style.transform === 'scale(0.65)',
    `state ${view.getState().zoom}, CSS ${canvas.style.transform}`,
  );

  scroller.scrollLeft = 0;
  scroller.scrollTop = 0;
  click(action('Center mind map'));
  const centeredLeft =
    canvas.offsetLeft +
    (canvas.offsetWidth * zoom() - scroller.clientWidth) / 2;
  const centeredTop =
    canvas.offsetTop +
    (canvas.offsetHeight * zoom() - scroller.clientHeight) / 2;

  check(
    'the center button brings a lost map back to the viewport center',
    Math.abs(scroller.scrollLeft - centeredLeft) < 1 &&
      Math.abs(scroller.scrollTop - centeredTop) < 1,
    `scroll ${scroller.scrollLeft}, ${scroller.scrollTop}; center ${centeredLeft}, ${centeredTop}`,
  );

  const touch = (x, y) => ({ clientX: x, clientY: y });
  const sendTouch = (type, touches) => {
    const event = new Event(type, { bubbles: true, cancelable: true });

    Object.defineProperty(event, 'touches', { value: touches });
    scroller.dispatchEvent(event);

    return event;
  };

  await setZoom(1);
  sendTouch('touchstart', [touch(50, 50), touch(150, 50)]);
  const pinch = sendTouch('touchmove', [touch(25, 50), touch(175, 50)]);

  sendTouch('touchend', []);
  check(
    'a two-finger pinch zooms around its midpoint',
    view.getState().zoom === 1.5 && pinch.defaultPrevented,
    `zoom ${view.getState().zoom}, prevented ${pinch.defaultPrevented}`,
  );
} finally {
  await setZoom(originalZoom);
}

return { results };
