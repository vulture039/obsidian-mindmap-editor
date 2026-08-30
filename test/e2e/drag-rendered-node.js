/** A rendered, image-heavy heading can be dragged into a lower hierarchy. */
await restore();
const fixture = [
  '# Rendered node text',
  '',
  '**bold** and ![[Assets/Preview.svg]]',
  '',
  '![Large](Assets/Large.svg)',
  '# Target',
].join('\n');

await setFile(fixture);
const source = label('Rendered node text')?.closest('.mindmap-node');
const target = label('Target')?.closest('.mindmap-node');
const image = await until(() => {
  const found = source?.querySelector('img.mindmap-node-image');

  return found?.complete ? found : null;
});

if (source && target && image) {
  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const pointer = {
    bubbles: true,
    pointerId: 17,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  };

  source.dispatchEvent(
    new PointerEvent('pointerdown', {
      ...pointer,
      clientX: from.left + from.width / 2,
      clientY: from.top + 12,
    }),
  );
  document.dispatchEvent(
    new PointerEvent('pointermove', {
      ...pointer,
      clientX: to.left + to.width / 2,
      clientY: to.top + to.height / 2,
    }),
  );
  document.dispatchEvent(
    new PointerEvent('pointerup', {
      ...pointer,
      buttons: 0,
      clientX: to.left + to.width / 2,
      clientY: to.top + to.height / 2,
    }),
  );
}

const expected = [
  '# Target',
  '## Rendered node text',
  '',
  '**bold** and ![[Assets/Preview.svg]]',
  '',
  '![Large](Assets/Large.svg)',
].join('\n');
const changed = await until(async () => {
  if ((await now()) !== expected) {
    return null;
  }

  return !el.querySelector('.mindmap-render-snapshot') &&
    !el.querySelector('.is-render-staging')
    ? true
    : null;
});

check(
  'an image-heavy rendered node can be dragged under another heading',
  changed,
  await now(),
);

await restore();

return { results };
