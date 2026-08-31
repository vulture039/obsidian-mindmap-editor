const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

interface NodeSpan {
  start: number;
  end: number;
  syntax: string;
}

export interface NodeImageEmbed extends NodeSpan {
  kind: 'image';
  target: string;
  alt: string;
}

export interface NodeLiteralEmbed extends NodeSpan {
  kind: 'literal';
}

export type NodeEmbed = NodeImageEmbed | NodeLiteralEmbed;

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\()[\]<> ])/g, '$1');
}

function isImagePath(target: string): boolean {
  const path = target.split(/[?#]/, 1)[0] ?? '';
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();

  return IMAGE_EXTENSIONS.has(extension);
}

function closingBracket(text: string, from: number): number {
  let depth = 0;

  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') {
      i++;
    } else if (text[i] === '[') {
      depth++;
    } else if (text[i] === ']') {
      if (depth === 0) {
        return i;
      }
      depth--;
    }
  }

  return -1;
}

function closingParen(text: string, from: number): number {
  let quote = '';

  for (let i = from; i < text.length; i++) {
    const ch = text[i] ?? '';

    if (ch === '\\') {
      i++;
    } else if (quote) {
      if (ch === quote) {
        quote = '';
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ')') {
      return i;
    }
  }

  return -1;
}

function markdownImageAt(text: string, start: number): NodeEmbed | null {
  const altEnd = closingBracket(text, start + 2);

  if (altEnd < 0 || text[altEnd + 1] !== '(') {
    return null;
  }
  let cursor = altEnd + 2;

  while (/\s/.test(text[cursor] ?? '')) {
    cursor++;
  }
  let target = '';
  let destinationEnd = cursor;

  if (text[cursor] === '<') {
    const targetStart = ++cursor;

    while (cursor < text.length && text[cursor] !== '>') {
      if (text[cursor] === '\\') {
        cursor++;
      }
      cursor++;
    }
    if (text[cursor] !== '>') {
      return null;
    }
    target = text.slice(targetStart, cursor);
    destinationEnd = cursor + 1;
  } else {
    const targetStart = cursor;
    let depth = 0;

    for (; cursor < text.length; cursor++) {
      const ch = text[cursor] ?? '';

      if (ch === '\\') {
        cursor++;
      } else if (ch === '(') {
        depth++;
      } else if (ch === ')') {
        if (depth === 0) {
          target = text.slice(targetStart, cursor);
          destinationEnd = cursor;
          break;
        }
        depth--;
      } else if (/\s/.test(ch) && depth === 0) {
        target = text.slice(targetStart, cursor);
        destinationEnd = cursor;
        break;
      }
    }
  }
  if (!target) {
    return null;
  }
  const endParen = closingParen(text, destinationEnd);

  if (endParen < 0) {
    return null;
  }

  return {
    kind: 'image',
    start,
    end: endParen + 1,
    syntax: text.slice(start, endParen + 1),
    target: unescapeMarkdown(target),
    alt: unescapeMarkdown(text.slice(start + 2, altEnd)),
  };
}

function wikiEmbedAt(text: string, start: number): NodeEmbed | null {
  const close = text.indexOf(']]', start + 3);

  if (close < 0) {
    return null;
  }
  const content = text.slice(start + 3, close);
  const separator = content.indexOf('|');
  const target = (separator < 0 ? content : content.slice(0, separator)).trim();
  const alias = separator < 0 ? '' : content.slice(separator + 1).trim();
  const span = {
    start,
    end: close + 2,
    syntax: text.slice(start, close + 2),
  };

  if (!isImagePath(target)) {
    return { kind: 'literal', ...span };
  }

  return {
    kind: 'image',
    ...span,
    target,
    alt: /^\d+(?:x\d+)?$/.test(alias) ? '' : alias,
  };
}

/**
 * Finds embeds outside code spans, retaining source offsets for replacement.
 * A scanner, rather than one regex, keeps escaped and nested Markdown paths
 * intact while leaving image-looking source inside inline code alone.
 */
export function parseNodeEmbeds(text: string): NodeEmbed[] {
  const embeds: NodeEmbed[] = [];

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '`') {
      let run = 1;

      while (text[i + run] === '`') {
        run++;
      }
      const close = text.indexOf('`'.repeat(run), i + run);

      if (close >= 0) {
        i = close + run - 1;
        continue;
      }
    }
    let embed: NodeEmbed | null = null;

    if (text.startsWith('![[', i)) {
      embed = wikiEmbedAt(text, i);
    } else if (text.startsWith('![', i)) {
      embed = markdownImageAt(text, i);
    }
    if (embed) {
      embeds.push(embed);
      i = embed.end - 1;
    }
  }

  return embeds;
}
