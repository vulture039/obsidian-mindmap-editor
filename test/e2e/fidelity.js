/**
 * Every write lands exactly where it was aimed, and the map shows what the file
 * says, in whichever mode the Markdown pane is in. Each case states the file it
 * expects character for character - not "nothing was lost", but "this and
 * nothing else changed".
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

// A write while the Markdown pane is edited underneath it: the map's line
// numbers are behind the file, and the write has to find its node again. Only
// an editing pane can be typed into.
for (let i = 0; reading ? false : i < 4; i++) {
  await restore();
  const before = await now();
  const at = before.split('\n').findIndex((l) => l.trim() === '- plain item');
  const input = await openLabel('plain item');

  if (!input) {
    check(`rename with the pane edited underneath (${i})`, false, 'no editor');
    continue;
  }
  const shifted = i % 2;

  if (shifted) {
    editor.replaceRange(`shifted ${i}\n`, { line: 0, ch: 0 });
  } else {
    editor.replaceRange('', { line: 0, ch: 0 }, { line: 1, ch: 0 });
  }
  const moved = await now();

  type(input, `renamed ${i}`);
  await written(moved);
  check(
    `rename with the pane edited underneath (${shifted ? 'a line added above' : 'a line taken from above'})`,
    (await now()) ===
      withLine(moved, at + (shifted ? 1 : -1), `- renamed ${i}`),
    'the rename did not land where the node had moved to',
  );
  await closeEditor();
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
