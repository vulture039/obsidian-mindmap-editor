/**
 * The note itself is a node on the map: it has prose of its own above the
 * first heading, a branch to fold, and a name - which is the file's.
 *
 * Wants the pane editing, so a write can be read back straight away.
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

// Its own text is text like any other: it takes an edit, and a line delete.
{
  await restore();
  const before = await now();
  const line = rootEl()?.querySelector('.mindmap-node-body-line');
  const input = await openBody(line);

  if (input) {
    type(input, `${held(input)} TYPED`);
    await written(before);
  }
  check(
    "typing in the note's own text reaches the file",
    (await now()).includes('TYPED'),
  );
}

{
  await restore();
  const before = await now();
  const line = rootEl()?.querySelector('.mindmap-node-body-line');
  const at = Number(line?.dataset.line);

  click(line);
  await until(() => line.hasClass('is-cursor-line'));
  key('Delete');
  await until(async () => (await now()) !== before);
  check(
    "a line of the note's own text can be deleted",
    (await now()) ===
      before
        .split('\n')
        .filter((_, i) => i !== at)
        .join('\n'),
  );
}

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

// Its name is the file's name, and renaming it renames the file - once the
// edit is over, not once per keystroke. On a note of its own: a rename rewrites
// every link to it, which the fixtures are not there to have done to them.
{
  await restore();
  const fixtures = view.file;
  const path = 'Renamable.md';
  const made =
    app.vault.getAbstractFileByPath(path) ??
    (await app.vault.create(path, '# Renamable\n\n- a node\n'));

  await view.setFile(made);
  await drawn();
  const input = await openLabel('Renamable');

  if (!input) {
    check('renaming the note renames the file', false, 'no editor opened');
  } else {
    type(input, 'Renamed by the map');
    await settle();
    check(
      'the file is not renamed while the name is still being typed',
      view.file?.basename === 'Renamable',
      `it is already ${view.file?.basename}`,
    );
    key('Enter');
    await until(() => view.file?.basename === 'Renamed by the map');
    check(
      'renaming the note renames the file',
      view.file?.basename === 'Renamed by the map',
      `the file is ${view.file?.path}`,
    );
  }
  for (const name of ['Renamable.md', 'Renamed by the map.md']) {
    const leftover = app.vault.getAbstractFileByPath(name);

    if (leftover) {
      await app.vault.delete(leftover);
    }
  }
  await view.setFile(fixtures);
  await drawn();
}

await restore();

return { results, mode: reading ? 'reading' : 'editing' };
