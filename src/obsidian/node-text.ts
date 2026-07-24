import { App, Keymap } from 'obsidian';

const LINK_RE =
  /\[\[([^[\]|]+)(?:\|([^[\]]*))?\]\]|\[([^[\]]+)\]\(([^()\s]+)\)/g;

/**
 * Renders node text with [[wikilinks]] and [label](url) as clickable links;
 * everything else stays plain text. When `onInternalLink` is given it
 * handles wikilink clicks (the view uses it to also follow the link on the
 * map and record history).
 */
export function renderNodeText(
  containerEl: HTMLElement,
  text: string,
  app: App,
  sourcePath: string,
  onInternalLink?: (target: string, evt: MouseEvent) => void,
): void {
  const makeLink = (
    cls: string,
    label: string,
    attr: Record<string, string> | undefined,
    onClick: (e: MouseEvent) => void,
  ): void => {
    const anchor = containerEl.createEl('a', { cls, text: label, attr });
    anchor.draggable = false;
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    });
  };
  let last = 0;
  for (const match of text.matchAll(LINK_RE)) {
    const index = match.index ?? 0;
    if (index > last) containerEl.appendText(text.slice(last, index));
    const wikiTarget = match[1];
    if (wikiTarget !== undefined) {
      const target = wikiTarget.trim();
      const alias = match[2]?.trim();
      makeLink(
        'internal-link mindmap-link',
        alias?.length ? alias : target,
        undefined,
        (e) => {
          if (onInternalLink) {
            onInternalLink(target, e);
          } else {
            void app.workspace.openLinkText(
              target,
              sourcePath,
              Keymap.isModEvent(e),
            );
          }
        },
      );
    } else {
      const url = match[4] ?? '';
      makeLink(
        'external-link mindmap-link',
        match[3] ?? '',
        { href: url },
        () => window.open(url),
      );
    }
    last = index + match[0].length;
  }
  if (last < text.length) containerEl.appendText(text.slice(last));
}
