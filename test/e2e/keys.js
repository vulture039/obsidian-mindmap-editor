/**
 * Real keystrokes, through Obsidian's own keymap. It sees a key before the
 * page does, so a key the map claims never reaches the editor standing on it -
 * and a dispatched event, which the keymap never sees at all, cannot tell.
 *
 * A line of a note went missing this way: Backspace typed into the map's own
 * editor was taken by the map, which deleted the line under it.
 *
 * Wants the pane editing, so a save can be read back straight away.
 */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

// Every key the map claims, pressed into an open editor. The map must not act
// on any of them: what they do, they do to the text being edited, and nothing
// outside the run being edited may move.
for (const [key, mods] of [
  ['Backspace', {}],
  ['Delete', {}],
  ['Enter', {}],
  [' ', {}],
  ['ArrowUp', {}],
  ['ArrowDown', { shiftKey: true }],
  ['Tab', {}],
  ['F2', {}],
]) {
  await restore();
  const before = await now();
  const input = await openBody('The description is indented');

  if (!input) {
    check(`${key} while editing`, false, 'no editor opened');
    continue;
  }
  const was = input.value;
  /** The file with the run being edited cut out of it. */
  const around = (text, run) => {
    const lines = text.split('\n');
    const first = run.split('\n')[0].trim();
    const at = lines.findIndex((l) => l.trim() === first);

    return [
      ...lines.slice(0, at),
      ...lines.slice(at + run.split('\n').length),
    ].join('\n');
  };

  input.focus();
  input.setSelectionRange(1, 1);
  await press(key, mods);
  await settle();
  const open = editing();

  check(
    `${key} while editing goes to the text, not the map`,
    !!open && around(before, was) === around(await now(), open.value),
    open
      ? 'it moved something outside the run being edited'
      : 'the editor was taken away',
  );
  open?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await until(() => !editing());
}

// And the keys the map is meant to have, with nothing being edited.
{
  await restore();
  const line = bodyLine('moves and deletes with it.');
  const at = Number(line?.dataset.line);
  const before = await now();

  click(line);
  await until(() => line.hasClass('is-cursor-line'));
  await press('Delete');
  await until(async () => (await now()) !== before);
  check(
    'Delete with nothing being edited takes the line it marks',
    (await now()) ===
      before
        .split('\n')
        .filter((_, i) => i !== at)
        .join('\n'),
  );
}

// Nothing is confirmed: what is typed goes on its own.
{
  await restore();
  const input = await openBody('The description is indented');

  input.focus();
  input.value = `${input.value} TYPED`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await until(async () => (await now()).includes('TYPED'));
  check(
    'typing reaches the file with nothing pressed',
    (await now()).includes('TYPED'),
  );

  // And Escape is not a discard any more - it is just the end of the edit.
  await press('Escape');
  await settle();
  check(
    'Escape leaves what was typed in the file',
    (await now()).includes('TYPED') && !editing(),
  );
}

await restore();

return { results, mode: reading ? 'reading' : 'editing' };
