/**
 * Real keystrokes, through Obsidian's own keymap. It sees a key before the page
 * does, so a key the map claims never reaches the editor standing on it - and a
 * dispatched event, which the keymap never sees at all, cannot tell.
 *
 * Wants the pane editing, so a write can be read back straight away.
 */
if (reading) {
  return fail('switch the Markdown pane out of reading view');
}

// Every key the map claims, pressed into an open editor. The map must not act
// on any of them: what they do, they do to the name being typed, and the map's
// own actions - delete a node, add one - would change how many lines there are.
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
  const input = await openLabel('plain item');

  if (!input) {
    check(`${key} while editing`, false, 'no editor opened');
    continue;
  }
  input.focus();
  await press(key, mods);
  await settle();
  // Enter ends a label edit, which is the editor's own doing; the rest leave
  // it open.
  const stillOpen = key === 'Enter' || !!editing();

  check(
    `${key} while editing goes to the name, not the map`,
    stillOpen && (await now()).split('\n').length === before.split('\n').length,
    stillOpen ? 'the file gained or lost a line' : 'the editor was taken away',
  );
  await closeEditor();
}

// And the keys the map is meant to have, with nothing being edited.
{
  await restore();
  const before = await now();

  click(label('plain item'));
  await until(() => el.querySelector('.mindmap-node.is-selected'));
  await press('Delete');
  await until(async () => (await now()) !== before);
  check(
    'Delete with nothing being edited takes the node it marks',
    !(await now()).includes('- plain item') &&
      (await now()).split('\n').length < before.split('\n').length,
  );
}

// Nothing is confirmed: what is typed goes on its own.
{
  await restore();
  const input = await openLabel('plain item');

  input.focus();
  type(input, 'plain itemTYPED');
  await until(async () => (await now()).includes('TYPED'));
  check(
    'typing reaches the file with nothing pressed',
    (await now()).includes('- plain itemTYPED'),
  );

  // And Escape is not a discard any more - it is just the end of the edit.
  await press('Escape');
  await settle();
  check(
    'Escape leaves what was typed in the file',
    (await now()).includes('- plain itemTYPED') && !editing(),
  );
}

await restore();

return { results, mode: reading ? 'reading' : 'editing' };
