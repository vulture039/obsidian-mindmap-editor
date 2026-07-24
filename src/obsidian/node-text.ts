import { App, Keymap } from 'obsidian';
import { parseNodeText } from '../core/node-text';

/**
 * Renders node text with [[wikilinks]] and [label](url) as clickable links;
 * everything else stays plain text. When `onInternalLink` is given it
 * handles wikilink clicks (the view uses it to also follow the link on the
 * map and record history). Link detection lives in core/node-text.ts.
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

  for (const segment of parseNodeText(text)) {
    if (segment.kind === 'text') {
      containerEl.appendText(segment.text);
    } else if (segment.kind === 'wikilink') {
      const { target, label } = segment;

      makeLink('internal-link mindmap-link', label, undefined, (e) => {
        if (onInternalLink) {
          onInternalLink(target, e);
        } else {
          void app.workspace.openLinkText(
            target,
            sourcePath,
            Keymap.isModEvent(e),
          );
        }
      });
    } else {
      const { url, label } = segment;

      makeLink('external-link mindmap-link', label, { href: url }, () =>
        window.open(url),
      );
    }
  }
}
