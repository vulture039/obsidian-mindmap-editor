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
		const a = containerEl.createEl('a', { cls, text: label, attr });
		a.draggable = false;
		a.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick(e);
		});
	};
	let last = 0;
	for (const m of text.matchAll(LINK_RE)) {
		const index = m.index ?? 0;
		if (index > last) containerEl.appendText(text.slice(last, index));
		const wikiTarget = m[1];
		if (wikiTarget !== undefined) {
			const target = wikiTarget.trim();
			const alias = m[2]?.trim();
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
			const url = m[4] ?? '';
			makeLink('external-link mindmap-link', m[3] ?? '', { href: url }, () =>
				window.open(url),
			);
		}
		last = index + m[0].length;
	}
	if (last < text.length) containerEl.appendText(text.slice(last));
}
