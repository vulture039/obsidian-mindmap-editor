/**
 * The handful of things Obsidian adds to the DOM that the plugin's own DOM
 * code calls. jsdom has none of them, and they are not worth mocking around:
 * each is a line, and with them the real code runs unaltered under a test.
 */

interface DivOptions {
  cls?: string;
  text?: string;
}

function make(o?: DivOptions | string): HTMLDivElement {
  const el = document.createElement('div');
  const options = typeof o === 'string' ? { cls: o } : o;

  if (options?.cls) {
    el.className = options.cls;
  }
  if (options?.text) {
    el.textContent = options.text;
  }

  return el;
}

/** The prototype patching Obsidian does at startup, as far as we lean on it. */
export function installObsidianDom(): void {
  const scope = globalThis as unknown as Record<string, unknown>;

  scope.createDiv = make;
  Object.defineProperties(Element.prototype, {
    doc: { get: (): Document => document, configurable: true },
    win: { get: (): Window => window, configurable: true },
  });

  Object.assign(Element.prototype as unknown as Record<string, unknown>, {
    createEl(this: Element, tag: keyof HTMLElementTagNameMap) {
      const el = document.createElement(tag);

      this.appendChild(el);

      return el;
    },
    createDiv(this: Element, o?: DivOptions | string) {
      const el = make(o);

      this.appendChild(el);

      return el;
    },
    addClass(this: Element, ...cls: string[]) {
      this.classList.add(...cls);
    },
    removeClass(this: Element, ...cls: string[]) {
      this.classList.remove(...cls);
    },
    toggleClass(this: Element, cls: string, on: boolean) {
      this.classList.toggle(cls, on);
    },
    hasClass(this: Element, cls: string) {
      return this.classList.contains(cls);
    },
    appendText(this: Element, text: string) {
      this.appendChild(document.createTextNode(text));
    },
    // Obsidian's cross-window instanceof, which is what the plugin uses.
    instanceOf<T>(this: Element, type: new () => T) {
      return this instanceof type;
    },
  });

  // jsdom has no innerText. What the plugin needs from it is the one thing
  // textContent gets wrong: a line the user made with Enter is a new element,
  // and the two must not run together.
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get(this: HTMLElement): string {
      const blocks = Array.from(this.children).filter((c) =>
        ['DIV', 'P', 'BR'].includes(c.tagName),
      );

      if (!blocks.length) {
        return this.textContent ?? '';
      }
      const lead = Array.from(this.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('');

      return [lead, ...blocks.map((b) => b.textContent ?? '')]
        .filter((line, i) => i > 0 || line !== '')
        .join('\n');
    },
    set(this: HTMLElement, value: string) {
      this.textContent = value;
    },
  });
}
