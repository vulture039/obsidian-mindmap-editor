/**
 * Enough of the `obsidian` module for the DOM-facing code to run under jsdom.
 * Only what that code actually calls: a stub that grew past this would start
 * testing itself rather than the plugin.
 */

export const Platform = { isMacOS: false };

export function setIcon(el: HTMLElement, icon: string): void {
  el.dataset.icon = icon;
}

export class Notice {
  static shown: (string | DocumentFragment)[] = [];

  constructor(message: string | DocumentFragment) {
    Notice.shown.push(message);
  }
}
