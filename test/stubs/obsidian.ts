/**
 * Enough of the `obsidian` module for the DOM-facing code to run under jsdom.
 * Only what that code actually calls: a stub that grew past this would start
 * testing itself rather than the plugin.
 */

export const Platform = { isMacOS: false };

export const Keymap = {
  isModEvent: (event: MouseEvent): boolean => event.ctrlKey || event.metaKey,
};

export class Component {}

export class MarkdownRenderer {
  static async render(
    _app: unknown,
    markdown: string,
    el: HTMLElement,
  ): Promise<void> {
    const code: string[] = [];
    const protectedMarkdown = markdown.replace(
      /`([^`]+)`/g,
      (_match, value) => {
        const index = code.push(String(value)) - 1;

        return `STUBCODEPLACEHOLDER${index}END`;
      },
    );
    const html = protectedMarkdown
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/\$([^$]+)\$/g, '<span class="math">$1</span>')
      .replace(
        /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
        (_match, target: string, alias: string | undefined) =>
          `<a class="internal-link" data-href="${target}">${alias ?? target}</a>`,
      )
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(
        /STUBCODEPLACEHOLDER(\d+)END/g,
        (_match, index: string) => `<code>${code[Number(index)] ?? ''}</code>`,
      );

    const parsed = new DOMParser().parseFromString(html, 'text/html');

    el.append(...parsed.body.childNodes);
  }
}

export function setIcon(el: HTMLElement, icon: string): void {
  el.dataset.icon = icon;
}

export class Notice {
  static shown: (string | DocumentFragment)[] = [];

  constructor(message: string | DocumentFragment) {
    Notice.shown.push(message);
  }
}
