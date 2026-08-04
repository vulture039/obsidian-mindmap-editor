/**
 * Every way the map writes, against a file that moves underneath it - the one
 * thing unit tests cannot reach, since it takes a real open editor and the
 * map's own deferred renders to put the two out of step.
 *
 * Wants the pane editing, which is the only kind the map writes through.
 */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

// What puts the map out of step: an edit in the Markdown pane while the map is
// mid-interaction, so its line numbers are behind the file by the time it
// writes. Odd rounds add a line above, even ones take one away.
const under = (i) => (i % 2 ? 'a line added above' : 'a line taken from above');
const shift = (i) =>
  i % 2
    ? editor.replaceRange(`shifted ${i}\n`, { line: 0, ch: 0 })
    : editor.replaceRange('', { line: 0, ch: 0 }, { line: 1, ch: 0 });

for (let i = 0; i < 4; i++) {
  await restore();
  const input = await openBody('The description is indented');

  if (!input) {
    check(`save a body edit, ${under(i)}`, false, 'no editor opened');
    continue;
  }
  shift(i);
  type(input, `${held(input)} typed${i}`);
  key('Enter', { ctrlKey: true });
  await until(
    async () => (await now()).includes(`typed${i}`) || editing() !== input,
  );

  const reopened = editing();

  // Either it saved, or it refused and gave the text back - never neither.
  check(
    `save a body edit, ${under(i)}`,
    (await now()).includes(`typed${i}`) ||
      (reopened && held(reopened).includes(`typed${i}`)),
  );
  key('Escape');
  await until(() => !editing());
}

// A refused save must not hand the text back onto a run that has moved on:
// leaving that editor would write the old lines over the new ones.
{
  await restore();
  const input = await openBody('A list item cannot own text');
  const at = (await now())
    .split('\n')
    .findIndex((l) => l.includes('child belongs to the child'));

  editor.replaceRange('  a line that arrived while editing\n', {
    line: at + 1,
    ch: 0,
  });
  const grown = await now();

  input.focus();
  type(input, `${held(input)} typed`);
  key('Enter', { ctrlKey: true });
  await until(() => editing() !== input);
  await closeEditor();
  await settle();

  check(
    'a refused edit is not handed back onto text that moved',
    (await now()) === grown,
  );
}

for (let i = 0; i < 4; i++) {
  await restore();
  const line = bodyLine('moves and deletes');
  const before = await now();
  const deleting = i % 2 === 1;

  if (!line) {
    check(name, false, 'the line to act on is not drawn');
    continue;
  }
  click(line);
  await until(() => line.hasClass('is-cursor-line'));
  shift(i);
  key(deleting ? 'Delete' : 'ArrowUp', deleting ? {} : { shiftKey: true });
  await until(async () => (await now()) !== before);
  const text = await now();

  check(
    `${deleting ? 'delete' : 'move'} a line of text, ${under(i)}`,
    deleting
      ? !text.includes('moves and deletes with it.')
      : text.includes(
          '  moves and deletes with it.\n  The description is indented',
        ),
  );
}

for (let i = 0; i < 3; i++) {
  await restore();
  const input = await openLabel('plain item');

  if (input) {
    shift(i);
    type(input, `renamed ${i}`);
    key('Enter');
    await until(async () => (await now()).includes(`- renamed ${i}`));
  }
  check(`rename a node, ${under(i)}`, (await now()).includes(`- renamed ${i}`));

  await restore();
  const box = label('open task')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-checkbox');

  shift(i);
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  await until(async () => (await now()).includes('- [x] open task'));
  check(
    `tick a checkbox, ${under(i)}`,
    (await now()).includes('- [x] open task'),
  );
}

await restore();
check('the file is back as it was found', (await now()) === original);

return { results, mode: reading ? 'reading' : 'editing' };
