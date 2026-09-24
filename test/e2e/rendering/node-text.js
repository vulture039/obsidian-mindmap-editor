/** Real Obsidian Markdown rendering, image resolution, fallback and folding. */
await restore();
const wasShowing = view.showBodyText;
const remoteImage =
  'https://raw.githubusercontent.com/vulture039/obsidian-mindmap-editor/master/docs/demo.gif';
const fixture = [
  '# Rendered text',
  '**bold** *italic* ~~gone~~ `code` $x^2$',
  '> quoted text',
  '![[Assets/Preview.svg]]',
  '![Preview](Assets/Preview.svg)',
  '![[Assets/Small.svg]]',
  '![Large](Assets/Large.svg)',
  '![[Assets/Portrait.svg]]',
  '![Wide](Assets/Wide.svg)',
  '![[Assets/Missing.png]]',
  '![Missing](Assets/Missing.png)',
  `![Remote demo](${remoteImage})`,
  '![[Linked.md]]',
  'before a blank line',
  '',
  '    indented after a blank line stays literal',
  '    indented code stays literal',
  '```js',
  'const untouched = true;',
  '```',
  '- [ ] task with a note',
  '  list note',
].join('\n');

view.showBodyText = true;
await setFile(fixture);
const node = label('Rendered text')?.closest('.mindmap-node');
const images = await until(() => {
  const found = [...(node?.querySelectorAll('img.mindmap-node-image') ?? [])];

  return found.length === 7 && found.every((image) => image.complete)
    ? found
    : null;
});
const image = images?.[0];
const imageNode = image?.closest('.mindmap-node');

check(
  'Obsidian renders inline Markdown in node text',
  !!node?.querySelector('strong') &&
    !!node.querySelector('em') &&
    !!node.querySelector('del') &&
    !!node.querySelector('code') &&
    !!node.querySelector('.math'),
  node?.textContent,
);
const quoteLine = bodyLine('quoted text');
const plainLine = bodyLine('indented code stays literal');
const afterBlankLine = bodyLine('indented after a blank line stays literal');
const quote = quoteLine?.querySelector('blockquote');
check(
  'block Markdown stays within one source-line height',
  !!quoteLine &&
    !!plainLine &&
    !!quote &&
    getComputedStyle(quote).display === 'inline' &&
    getComputedStyle(quote, '::before').content.includes('>') &&
    quoteLine.offsetHeight <= plainLine.offsetHeight + 6,
  JSON.stringify({
    quote: quoteLine?.offsetHeight,
    plain: plainLine?.offsetHeight,
    blockquote: quote && {
      display: getComputedStyle(quote).display,
      margin: getComputedStyle(quote).margin,
      padding: getComputedStyle(quote).padding,
      lineHeight: getComputedStyle(quote).lineHeight,
    },
    paragraph: quote?.querySelector('p') && {
      display: getComputedStyle(quote.querySelector('p')).display,
      margin: getComputedStyle(quote.querySelector('p')).margin,
    },
  }),
);
if (!reading) {
  click(plainLine);
  const sourceHighlight = await until(
    () => [...(CSS.highlights.get('mindmap-line') ?? [])][0] ?? null,
  );

  check(
    'map selection highlights source content without its indent',
    sourceHighlight?.toString() === 'indented code stays literal',
    sourceHighlight?.toString(),
  );
}
check(
  'indentation after a blank line does not become code',
  !!afterBlankLine &&
    afterBlankLine.textContent.includes(
      '    indented after a blank line stays literal',
    ) &&
    !afterBlankLine.querySelector('code'),
  afterBlankLine?.innerHTML,
);
check(
  'both image syntaxes and source dimensions render bounded vault images',
  images?.length === 7 &&
    images.every(
      (item) =>
        item.naturalWidth > 0 &&
        item.naturalHeight > 0 &&
        item.offsetWidth > 0 &&
        item.offsetWidth <= imageNode?.offsetWidth &&
        item.offsetHeight > 0 &&
        item.offsetHeight <= 210,
    ),
  images?.map((item) => `${item.offsetWidth}x${item.offsetHeight}`),
);
check(
  'the remote Markdown image loads from its URL',
  images?.some(
    (item) => item.currentSrc === remoteImage && item.naturalWidth > 0,
  ),
  images?.map((item) => item.currentSrc),
);
check(
  'large landscape fixtures fill their node text width',
  images
    ?.filter(
      (item) =>
        item.naturalWidth > 80 && item.naturalWidth >= item.naturalHeight,
    )
    .every((item) => {
      const line = item.closest('.mindmap-node-body-line');

      return line && Math.abs(item.offsetWidth - line.offsetWidth) < 1;
    }),
  images
    ?.filter(
      (item) =>
        item.naturalWidth > 80 && item.naturalWidth >= item.naturalHeight,
    )
    .map((item) => {
      const line = item.closest('.mindmap-node-body-line');

      return `${item.offsetWidth}/${line?.offsetWidth}`;
    }),
);
check(
  'the small fixture keeps its intrinsic size',
  images?.some(
    (item) =>
      item.naturalWidth === 80 &&
      item.naturalHeight === 60 &&
      item.offsetWidth === 80 &&
      item.offsetHeight === 60,
  ),
  images?.map((item) => [item.naturalWidth, item.offsetWidth]),
);
check(
  'the portrait fixture is limited by height',
  images?.some(
    (item) =>
      item.naturalWidth === 600 &&
      item.naturalHeight === 1200 &&
      item.offsetHeight === 210,
  ),
  images?.map((item) => [item.naturalHeight, item.offsetHeight]),
);
check(
  'missing and non-image embeds remain literal',
  node?.textContent.includes('![[Assets/Missing.png]]') &&
    node?.textContent.includes('![Missing](Assets/Missing.png)') &&
    node?.textContent.includes('![[Linked.md]]'),
  node?.textContent,
);
check(
  'indented text does not become a code block',
  node?.textContent.includes('    indented code stays literal') &&
    !node?.querySelector('.copy-code-button'),
  node?.innerHTML,
);
check(
  'fenced code remains source text',
  node?.textContent.includes('```js') &&
    node?.textContent.includes('const untouched = true;'),
  node?.textContent,
);
check(
  'every kind of node body uses the same bordered field',
  [...el.querySelectorAll('.mindmap-node-body')].every((body) => {
    const style = getComputedStyle(body);

    return style.borderTopStyle === 'solid' && style.borderTopWidth === '1px';
  }),
);

if (!reading) {
  const listNote = bodyLine('list note');
  const listLine = Number(listNote?.dataset.line);

  click(listNote, 'dblclick');
  await until(
    () =>
      editor.hasFocus() &&
      editor.getCursor().line === listLine &&
      editor.getCursor().ch === editor.getLine(listLine).length,
  );
  await press('Enter');
  await until(() => editor.getLine(listLine + 1) === '  ');
  check(
    'Enter in a task note adds a note line instead of a task',
    editor.getLine(listLine + 1) === '  ' &&
      !editor.getLine(listLine + 1).startsWith('- [ ]'),
    editor.getValue(),
  );
  await until(() => !view.renderQueued);
}

if (!reading) {
  const at = editor
    .getValue()
    .split('\n')
    .findIndex((line) => line.includes('bold'));
  const line = drawnAt(at);
  const before = editor.getValue();
  const originalWriteFile = view.writeFile;
  let mapWrites = 0;

  view.writeFile = (...args) => {
    mapWrites++;

    return originalWriteFile.apply(view, args);
  };
  try {
    click(line);
    click(line, 'pointerdown');
    click(line, 'dblclick');
    await until(() => editor.hasFocus());
    await settle();
    editor.setCursor({ line: at, ch: 4 });
    const mirroredLine = await until(() => {
      const current = drawnAt(at);

      return current?.querySelector('.mindmap-mirrored-caret') ? current : null;
    });

    check(
      'body editing mirrors its caret on the map',
      !!mirroredLine && !editing(),
      mirroredLine?.innerHTML,
    );
    editor.replaceRange('X', { line: at, ch: 4 });
    const expected = before
      .split('\n')
      .map((text, lineNumber) =>
        lineNumber === at ? `${text.slice(0, 4)}X${text.slice(4)}` : text,
      )
      .join('\n');
    const updated = await until(() => {
      const current = drawnAt(at);

      return current?.textContent === expected.split('\n')[at] &&
        current.querySelector('.mindmap-mirrored-caret')
        ? current
        : null;
    });

    check(
      'typing in Markdown updates the mirror without changing anything else',
      !!updated && editor.getValue() === expected,
      updated?.innerHTML,
    );
    editor.setCursor({ line: at, ch: editor.getLine(at).length });
    const nodesBeforeEnter = el.querySelectorAll('.mindmap-node').length;
    const linesBeforeEnter = editor.lineCount();
    const selectedDuringEnter = [];
    const selectionObserver = new MutationObserver(() => {
      const selected = el.querySelector('.mindmap-node.is-selected');

      if (selected) {
        selectedDuringEnter.push(selected.dataset.line);
      }
    });

    selectionObserver.observe(el, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    });

    await press('Enter', { shiftKey: true });
    const blankLine = await until(() => {
      const current = drawnAt(at + 1);

      return editor.lineCount() === linesBeforeEnter + 1 &&
        current?.querySelector('.mindmap-mirrored-caret')
        ? current
        : null;
    });
    check(
      'Enter opens the next body line without creating a node',
      !!blankLine &&
        blankLine.querySelector('.mindmap-mirrored-caret') &&
        el.querySelectorAll('.mindmap-node').length === nodesBeforeEnter,
      blankLine?.outerHTML,
    );
    check(
      'an empty editing line keeps a map row without changing the editor',
      blankLine.offsetHeight > 0 &&
        !md.view.containerEl.querySelector('.mindmap-editing-highlight'),
      blankLine?.outerHTML,
    );
    await press('N');
    const nextText = await until(() => {
      const current = drawnAt(at + 1);

      return current?.textContent === 'N' ? current : null;
    });
    await until(() => !view.renderSnapshot && !view.renderQueued);
    check(
      'typing after Enter stays in the same body',
      !!nextText &&
        editor.getLine(at + 1) === 'N' &&
        el.querySelectorAll('.mindmap-node').length === nodesBeforeEnter,
      nextText?.outerHTML,
    );
    const mapFocusedLines = editor.lineCount();
    const mapFocusedIndent = /^\s*/.exec(editor.getLine(at + 1))?.[0] ?? '';

    click(nextText);
    await until(() => document.activeElement === view.scrollerEl);
    const restoredLine = await until(() => {
      const current = drawnAt(at + 1);

      return current && !current.querySelector('.mindmap-mirrored-caret')
        ? current
        : null;
    });
    check(
      'leaving Markdown editing restores the map body without its caret',
      !!restoredLine,
      restoredLine?.innerHTML,
    );
    await press('Enter');
    await until(() => editor.lineCount() === mapFocusedLines + 1);
    check(
      'Enter from the map adds one indented body line',
      editor.lineCount() === mapFocusedLines + 1 &&
        editor.getLine(at + 2) === mapFocusedIndent &&
        el.querySelectorAll('.mindmap-node').length === nodesBeforeEnter,
      editor.getValue(),
    );
    editor.focus();
    selectionObserver.disconnect();
    check(
      'Shift+Enter never focuses the following node',
      selectedDuringEnter.every((line) => line === '0'),
      selectedDuringEnter.join(', '),
    );
    check(
      'showing the editing mirror never writes from the map',
      mapWrites === 0,
      `${mapWrites} map writes`,
    );
    editor.focus();
    await press('Escape');
    const leftEditing = await until(
      () =>
        document.activeElement === view.scrollerEl &&
        !el.querySelector('.mindmap-mirrored-caret'),
    );
    check(
      'Escape returns from body editing to the map without its caret',
      !!leftEditing,
      document.activeElement?.className,
    );
    await press('Escape');
    const leftBodySelection = await until(
      () =>
        !restoredLine?.hasClass('is-cursor-line') &&
        !!el.querySelector('.mindmap-node.is-selected'),
    );
    check(
      'a second Escape leaves the node selected after its body line',
      !!leftBodySelection,
      restoredLine?.className,
    );
    await press('Escape');
    const leftNodeSelection = await until(
      () => !el.querySelector('.mindmap-node.is-selected'),
    );
    check('a third Escape clears the node selection', !!leftNodeSelection);
  } finally {
    view.writeFile = originalWriteFile;
  }
}

view.foldedText.add(0);
await view.render();
check(
  'folding node text removes its image preview',
  !label('Rendered text')?.closest('.mindmap-node')?.querySelector('img'),
);

view.foldedText.delete(0);
view.showBodyText = wasShowing;
await restore();

return { results };
