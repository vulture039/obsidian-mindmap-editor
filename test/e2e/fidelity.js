/**
 * Every edit lands exactly where it was aimed, both ways round, in whichever
 * mode the Markdown pane is in. Each case states the file it expects character
 * for character - not "nothing was lost", but "this and nothing else changed".
 *
 * Run it twice: once with the pane editing, once with it in reading view.
 */

/** The file with one line put in place of another. */
const withLine = (text, at, line) => {
  const lines = text.split('\n');

  lines[at] = line;

  return lines.join('\n');
};

// ---------------------------------------------------------------- map -> md

for (const target of [
  'The description is indented',
  'moves and deletes with it.',
  'Text before the first item',
  'tail after the block',
  // Deeper than the run's own indent: a code block inside a description.
  'indented four spaces',
  'exactly as deep',
]) {
  await restore();
  const line = bodyLine(target);

  if (!line) {
    check(`type into "${target}"`, false, 'not drawn');
    continue;
  }
  const at = Number(line.dataset.line);
  const before = await now();
  const was = before.split('\n')[at];
  const input = await openBody(line);

  if (!input) {
    check(`type into "${target}"`, false, 'no editor opened');
    continue;
  }
  // Type at the end of the line the double-click landed on, wherever it sits
  // in the run the editor holds.
  const lines = held(input).split('\n');
  const index = lines.findIndex((l) => l.trim() === was.trim());

  lines[index] = `${lines[index]}EDIT`;
  type(input, lines.join('\n'));
  await written(before);

  check(
    `type into "${target}"`,
    (await now()) === withLine(before, at, `${was}EDIT`),
    'the file is not what that edit says it should be',
  );
}

await restore();
{
  const before = await now();
  const at = before.split('\n').findIndex((l) => l.trim() === '- plain item');
  const input = await openLabel('plain item');

  if (input) {
    type(input, 'plain itemEDIT');
    await written(before);
  }
  check(
    'rename a node',
    (await now()) === withLine(before, at, '- plain itemEDIT'),
    'a rename changed more than the node it named',
  );
}

await restore();
{
  const before = await now();
  const at = before.split('\n').findIndex((l) => l.includes('[ ] open task'));
  const box = label('open task')
    ?.closest('.mindmap-node')
    ?.querySelector('.mindmap-checkbox');

  if (box) {
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    await until(async () => (await now()) !== before);
  }
  check(
    'tick a checkbox',
    (await now()) ===
      withLine(before, at, before.split('\n')[at].replace('[ ]', '[x]')),
    'ticking wrote more than the box',
  );
}

for (const [name, press, expect] of [
  [
    'delete a line of text',
    () => key('Delete'),
    (lines, at) => lines.filter((_, i) => i !== at),
  ],
  [
    'move a line of text',
    () => key('ArrowUp', { shiftKey: true }),
    (lines, at) => [
      ...lines.slice(0, at - 1),
      lines[at],
      lines[at - 1],
      ...lines.slice(at + 1),
    ],
  ],
]) {
  await restore();
  const line = bodyLine('moves and deletes with it.');
  const at = Number(line?.dataset.line);
  const before = await now();

  if (!line) {
    check(name, false, 'the line to act on is not drawn');
    continue;
  }
  click(line);
  await until(() => line.hasClass('is-cursor-line'));
  press();
  await until(async () => (await now()) !== before);
  check(name, (await now()) === expect(before.split('\n'), at).join('\n'));
}

// A line typed into the middle of a run, one taken out of it, and the whole
// run emptied - the three ways an edit changes how many lines a node has.
for (const [name, edit, expect] of [
  [
    'add a line to a run',
    (lines) => [...lines.slice(0, 1), 'a new line', ...lines.slice(1)],
    (file, at) => [
      ...file.slice(0, at + 1),
      '  a new line',
      ...file.slice(at + 1),
    ],
  ],
  [
    'take a line out of a run',
    (lines) => lines.slice(0, 1),
    (file, at) => file.filter((_, i) => i !== at + 1),
  ],
  [
    'empty a run',
    () => [],
    (file, at) => file.filter((_, i) => i !== at && i !== at + 1),
  ],
]) {
  await restore();
  const line = bodyLine('The description is indented');
  const at = Number(line?.dataset.line);
  const before = await now();
  const input = await openBody(line);

  if (!input) {
    check(name, false, 'no editor opened');
    continue;
  }
  type(input, edit(held(input).split('\n')).join('\n'));
  await written(before);
  check(name, (await now()) === expect(before.split('\n'), at).join('\n'));
}

// Text put on a node that had none: there is no run to replace, so it goes in
// under the node itself, indented to sit inside it.
for (const [name, indent] of [
  ['plain item', '  '],
  ['Level three', ''],
]) {
  await restore();
  const before = await now();
  const all = [];
  const walk = (n) => {
    all.push(n);
    n.children.forEach(walk);
  };

  walk(view.root);
  const node = all.find((n) => n.text === name);

  view.editBodyFromMenu(node);
  const input = await until(() => editing());

  if (!input) {
    check(`add text to "${name}"`, false, 'no editor opened');
    continue;
  }
  type(input, 'text put here');
  await written(before);
  const lines = before.split('\n');
  const at = lines.findIndex((l) => l.trim().endsWith(name));

  check(
    `add text to "${name}"`,
    (await now()) ===
      [
        ...lines.slice(0, at + 1),
        `${indent}text put here`,
        ...lines.slice(at + 1),
      ].join('\n'),
    'it did not land under the node it was added to',
  );
  await closeEditor();
}

// A hard line break is two spaces nobody can see: an edit elsewhere in the run
// must not tidy them away.
{
  await restore();
  await setFile(
    original.replace(
      '  The description is indented under the item, has no marker of its own, and\n',
      '  The description is indented under the item, has no marker of its own, and  \n',
    ),
  );
  const line = bodyLine('moves and deletes with it.');
  const before = await now();
  const at = Number(line?.dataset.line);
  const input = await openBody(line);

  if (input) {
    const lines = held(input).split('\n');

    lines[lines.length - 1] = `${lines[lines.length - 1]}EDIT`;
    type(input, lines.join('\n'));
    await written(before);
  }
  check(
    'keep a hard line break in the same run',
    (await now()) === withLine(before, at, `${before.split('\n')[at]}EDIT`),
    'the two spaces that end the line above were not left alone',
  );
}

// Deleting a node takes its own block and nothing else.
{
  await restore();
  const before = await now();
  const at = before.split('\n').findIndex((l) => l.trim() === '- plain item');

  click(label('plain item'));
  await until(() => el.querySelector('.mindmap-node.is-selected'));
  key('Delete');
  await until(async () => (await now()) !== before);
  const after = (await now()).split('\n');
  const lines = before.split('\n');
  const removed = lines.length - after.length;

  check(
    'delete a node',
    removed > 0 &&
      [...lines.slice(0, at), ...lines.slice(at + removed)].join('\n') ===
        after.join('\n'),
    `${removed} lines went, and not as one block`,
  );
}

// ---------------------------------------------------------------- md -> map

for (const [what, edit, shows] of [
  [
    'text added in the Markdown pane',
    (text) =>
      text.replace(
        'moves and deletes with it.',
        'moves and deletes with it. FROM MD',
      ),
    'moves and deletes with it. FROM MD',
  ],
  [
    'a line added in the Markdown pane',
    (text) =>
      text.replace(
        '  moves and deletes with it.\n',
        '  moves and deletes with it.\n  a whole new line\n',
      ),
    'a whole new line',
  ],
  [
    'a line removed in the Markdown pane',
    (text) => text.replace('  moves and deletes with it.\n', ''),
    null,
  ],
]) {
  await restore();
  await setFile(edit(original));
  const text = await now();

  if (shows) {
    const at = text.split('\n').findIndex((l) => l.trim() === shows.trim());
    const line = await until(() => drawnAt(at));

    check(
      `the map shows ${what}`,
      line?.textContent.trim() === shows.trim(),
      `line ${at} is drawn as ${JSON.stringify(line?.textContent)}`,
    );
  } else {
    check(
      `the map shows ${what}`,
      !bodyLine('moves and deletes with it.'),
      'a line that is gone from the file is still on the map',
    );
  }
}

// What only a reading pane can be asked about.
if (reading) {
  // Everything open to begin with, whatever the last check left.
  view.setAllCollapsed(0, false);
  await drawn();
  const pane = md.view.containerEl.querySelector('.markdown-preview-view');
  /** Whether each heading the map can fold is folded in the pane. */
  const headings = () =>
    (md.view.currentMode.renderer?.sections ?? [])
      .filter((s) => s.el?.querySelector('.heading-collapse-indicator'))
      .map((s) => ({
        line: s.start?.line,
        folded: s.el
          .querySelector('.heading-collapse-indicator')
          .hasClass('is-collapsed'),
      }));
  const matches = () =>
    headings().every((h) => h.folded === view.collapsedBranches.has(h.line));

  await restore();
  view.setAllCollapsed(0, false);
  await until(matches);
  check('a reading pane unfolds with the map', matches());

  view.setAllCollapsed(0, true);
  await until(matches);
  check(
    'a reading pane folds its headings with the map',
    headings().length > 0 && matches(),
    JSON.stringify(headings()),
  );
  view.setAllCollapsed(0, false);
  await until(matches);

  // A code block is not made of lines the way prose is; the line is found in
  // it by what it says instead.
  await restore();
  const line = bodyLine('const x = 1;');

  click(line);
  const marked = await until(() =>
    [...(CSS.highlights.get('mindmap-line') ?? [])]
      .map((r) => r.toString().trim())
      .find((t) => t === 'const x = 1;'),
  );

  check('a line inside a code block is marked in a reading pane', !!marked);
}

await restore();

return { results, mode: reading ? 'reading' : 'editing' };
