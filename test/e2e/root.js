/**
 * The note itself is a node on the map: the prose above its first heading is
 * its own text, and both that and its branch fold like any other node's.
 */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

const rootEl = () =>
  [...el.querySelectorAll('.mindmap-node')].find(
    (n) =>
      n.querySelector('.mindmap-node-text')?.textContent ===
      view.file?.basename,
  );
/** The handles drawn beside the note's own pill. */
const rootHandles = () => {
  const pill = rootEl()?.getBoundingClientRect();

  return [...el.querySelectorAll('.mindmap-collapse')].filter((h) => {
    const box = h.getBoundingClientRect();

    return (
      !!pill &&
      Math.abs(box.top - pill.top) < pill.height &&
      Math.abs(box.left - pill.right) < 40
    );
  });
};

await restore();
check(
  'the prose above the first heading is drawn on the note',
  (rootEl()?.querySelectorAll('.mindmap-node-body-line').length ?? 0) > 0,
  'the note has no text of its own on the map',
);

// Its branch folds, and so does its text - on the map, since neither has a
// line in the file for the editor to fold.
{
  await restore();
  const before = el.querySelectorAll('.mindmap-node').length;
  const branch = rootHandles().find((h) => !h.hasClass('is-body'));

  click(branch);
  await until(() => el.querySelectorAll('.mindmap-node').length !== before);
  const folded = el.querySelectorAll('.mindmap-node').length;

  click(rootHandles().find((h) => !h.hasClass('is-body')));
  await until(() => el.querySelectorAll('.mindmap-node').length === before);
  check(
    "the note's branch folds and comes back",
    folded === 1 && el.querySelectorAll('.mindmap-node').length === before,
    `${before} nodes became ${folded}`,
  );
}

{
  await restore();
  const drawn = () =>
    rootEl()?.querySelectorAll('.mindmap-node-body-line').length ?? 0;
  const before = drawn();

  click(rootHandles().find((h) => h.hasClass('is-body')));
  await until(() => drawn() !== before);
  const folded = drawn();

  click(rootHandles().find((h) => h.hasClass('is-body')));
  await until(() => drawn() === before);
  check(
    "the note's own text folds and comes back",
    folded === 0 && drawn() === before,
    `${before} lines became ${folded}`,
  );
}

await restore();

return { results, mode: reading ? 'reading' : 'editing' };
