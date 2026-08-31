import { App, Component, Keymap, MarkdownRenderer } from 'obsidian';
import { NodeImageEmbed, parseNodeEmbeds } from '../../core/parse/node-text';

const EXTERNAL_IMAGE = /^(?:https?:|data:|blob:|\/\/)/i;
const SHOW_TEXT = 4;

interface RenderContext {
  containerEl: HTMLElement;
  app: App;
  sourcePath: string;
  onContentSettled?: () => void;
}

/** What a protected Markdown placeholder becomes after Obsidian renders it. */
type EmbedReplacement = NodeImageEmbed | { kind: 'literal'; syntax: string };

function vaultTarget(target: string): string {
  const path = target.split(/[?#]/, 1)[0] ?? target;

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function imageSource(
  embed: NodeImageEmbed,
  context: RenderContext,
): string | null {
  if (EXTERNAL_IMAGE.test(embed.target)) {
    return embed.target;
  }
  const file = context.app.metadataCache.getFirstLinkpathDest(
    vaultTarget(embed.target),
    context.sourcePath,
  );

  return file ? context.app.vault.getResourcePath(file) : null;
}

function imageNode(embed: NodeImageEmbed, context: RenderContext): Node {
  const { containerEl, app, sourcePath, onContentSettled } = context;
  const src = imageSource(embed, context);

  if (!src) {
    return containerEl.doc.createTextNode(embed.syntax);
  }
  const image = containerEl.createEl('img');

  image.className = 'mindmap-node-image';
  image.alt = embed.alt;
  image.draggable = false;
  image.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (EXTERNAL_IMAGE.test(embed.target)) {
      containerEl.win.open(embed.target);
    } else {
      void app.workspace.openLinkText(
        vaultTarget(embed.target),
        sourcePath,
        Keymap.isModEvent(e),
      );
    }
  });
  image.addEventListener('dblclick', (e) => e.stopPropagation());
  image.addEventListener('load', () => onContentSettled?.());
  image.addEventListener('error', () => {
    image.replaceWith(embed.syntax);
    onContentSettled?.();
  });
  image.src = src;

  return image;
}

function restoreEmbeds(
  tokens: Map<string, EmbedReplacement>,
  context: RenderContext,
): number {
  if (!tokens.size) {
    return 0;
  }
  const walker = context.containerEl.doc.createTreeWalker(
    context.containerEl,
    SHOW_TEXT,
  );
  const textNodes: Text[] = [];
  let restored = 0;

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }
  for (const node of textNodes) {
    const matches = [...tokens.entries()]
      .map(([token, embed]) => ({
        token,
        embed,
        index: node.data.indexOf(token),
      }))
      .filter(({ index }) => index >= 0)
      .sort((a, b) => a.index - b.index);

    if (!matches.length) {
      continue;
    }
    const replacement: (Node | string)[] = [];
    let last = 0;

    for (const { token, embed, index } of matches) {
      replacement.push(node.data.slice(last, index));
      replacement.push(
        embed.kind === 'image'
          ? imageNode(embed, context)
          : context.containerEl.doc.createTextNode(embed.syntax),
      );
      restored++;
      last = index + token.length;
    }
    replacement.push(node.data.slice(last));
    node.replaceWith(...replacement);
  }

  return restored;
}

function wireLinks(
  containerEl: HTMLElement,
  onInternalLink?: (target: string, evt: MouseEvent) => void,
): void {
  for (const link of containerEl.querySelectorAll<HTMLElement>('a')) {
    link.addClass('mindmap-link');
    link.setAttribute('draggable', 'false');
    link.addEventListener('click', (e) => e.stopPropagation());
    link.addEventListener('dblclick', (e) => e.stopPropagation());
  }
  if (!onInternalLink) {
    return;
  }
  for (const link of containerEl.querySelectorAll<HTMLElement>(
    'a.internal-link',
  )) {
    link.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const target = link.dataset.href ?? link.getAttribute('href') ?? '';

        onInternalLink(target, e);
      },
      { capture: true },
    );
  }
}

/** Renders one source line as inline Markdown and bounded image previews. */
export async function renderNodeText(
  containerEl: HTMLElement,
  text: string,
  app: App,
  sourcePath: string,
  component: Component,
  onInternalLink?: (target: string, evt: MouseEvent) => void,
  onContentSettled?: () => void,
): Promise<void> {
  const embeds = parseNodeEmbeds(text);
  const nonce = containerEl.win.crypto.randomUUID();
  const tokens = new Map<string, EmbedReplacement>();
  let markdown = '';
  let last = 0;

  for (const [index, embed] of embeds.entries()) {
    const token = `\u{e000}${nonce}-${index}\u{e001}`;

    markdown += text.slice(last, embed.start) + token;
    tokens.set(token, embed);
    last = embed.end;
  }
  markdown += text.slice(last);
  const indent = /^\s+/.exec(markdown)?.[0] ?? '';

  if (indent) {
    const token = `\u{e000}${nonce}-indent\u{e001}`;

    tokens.set(token, { kind: 'literal', syntax: indent });
    markdown = token + markdown.slice(indent.length);
  }

  await MarkdownRenderer.render(
    app,
    markdown,
    containerEl,
    sourcePath,
    component,
  );
  const context = { containerEl, app, sourcePath, onContentSettled };

  if (restoreEmbeds(tokens, context) !== tokens.size) {
    throw new Error('Mindmap: Markdown renderer dropped an embed placeholder');
  }
  wireLinks(containerEl, onInternalLink);
  onContentSettled?.();
}
