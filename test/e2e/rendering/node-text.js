/** Real Obsidian Markdown rendering, image resolution, fallback and folding. */
await restore();
const wasShowing = view.showBodyText;
const remoteImage =
  'https://raw.githubusercontent.com/vulture039/obsidian-mindmap-editor/master/docs/demo.gif';
const fixture = [
  '# Rendered text',
  '**bold** *italic* ~~gone~~ `code` $x^2$',
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
  '    indented code stays literal',
  '```js',
  'const untouched = true;',
  '```',
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
