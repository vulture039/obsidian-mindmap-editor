await md.setViewState({
  type: 'markdown',
  state: { file: file.path, mode: 'preview' },
});
await until(() => md.view.getMode() === 'preview');
await drawn();

const source = editor.getValue().split('\n');
const line = source.findIndex((text) =>
  text.includes('moves and deletes with it.'),
);
const findNode = (node) => {
  if (node.body?.some((body) => body.line === line)) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child);

    if (found) return found;
  }
  return null;
};
const node = findNode(view.root);
let first = line;
let last = line;
const bodyText = (at) => node?.body.find((body) => body.line === at)?.text;

while (bodyText(first - 1)?.trim()) first--;
while (bodyText(last + 1)?.trim()) last++;
if (node?.type === 'list' && first === node.line + 1) first = node.line;

await view.editor.goToLine(line, { first, lines: last - first + 1 });
const highlight = await until(
  () =>
    md.view.containerEl.querySelector(
      '.markdown-preview-view .mindmap-line-highlight',
    ) ?? [...(CSS.highlights.get('mindmap-line') ?? [])][0],
);
const nativeFlash = md.view.containerEl.querySelector(
  '.markdown-preview-view .is-flashing',
);
const pane = md.view.containerEl.querySelector('.markdown-preview-view');
const textRange = (needle) => {
  const walk = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);

  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const at = node.textContent.indexOf(needle);

    if (at < 0) continue;
    const found = document.createRange();

    found.setStart(node, at);
    found.setEnd(node, at + needle.length);
    return found;
  }
  return null;
};
const selected = textRange('moves and deletes with it.');
const adjacent = textRange(
  'The description is indented under the item, has no marker of its own, and',
);

check(
  'the indented line keeps the content highlight',
  !!highlight,
  highlight?.textContent ?? highlight?.toString(),
);
check(
  'the native flash cannot reflow the highlighted line',
  !nativeFlash,
  nativeFlash?.outerHTML,
);
check(
  'the highlighted line keeps the same indentation as its adjacent line',
  !!selected &&
    !!adjacent &&
    Math.abs(
      selected.getBoundingClientRect().left -
        adjacent.getBoundingClientRect().left,
    ) < 1,
  `${selected?.getBoundingClientRect().left} / ${adjacent?.getBoundingClientRect().left}`,
);

await md.setViewState({
  type: 'markdown',
  state: { file: file.path, mode: 'source', source: false },
});

return { results, mode: 'preview-indent' };
