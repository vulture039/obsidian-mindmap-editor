import { describe, expect, it } from 'vitest';
import { parseNodeEmbeds } from './node-text';

function firstImage(text: string) {
  const embed = parseNodeEmbeds(text)[0];

  return embed?.kind === 'image' ? embed : null;
}

describe('parseNodeEmbeds', () => {
  it('finds Obsidian and Markdown images in source order', () => {
    expect(
      parseNodeEmbeds('before ![[image.png|caption]] and ![alt](assets/a.jpg)'),
    ).toEqual([
      {
        kind: 'image',
        start: 7,
        end: 29,
        syntax: '![[image.png|caption]]',
        target: 'image.png',
        alt: 'caption',
      },
      {
        kind: 'image',
        start: 34,
        end: 54,
        syntax: '![alt](assets/a.jpg)',
        target: 'assets/a.jpg',
        alt: 'alt',
      },
    ]);
  });

  it('supports spaces, angle destinations, nested parentheses and titles', () => {
    expect(
      [
        '![a](<My Image.png>)',
        '![b](image(1).png)',
        '![c](image.png "title")',
        String.raw`![d](My\ Image.png)`,
      ].map((text) => firstImage(text)?.target),
    ).toEqual(['My Image.png', 'image(1).png', 'image.png', 'My Image.png']);
  });

  it('does not turn embeds inside inline code into previews', () => {
    expect(parseNodeEmbeds('`![[code.png]]` ![[shown.png]]')).toEqual([
      expect.objectContaining({ target: 'shown.png', kind: 'image' }),
    ]);
  });

  it('keeps non-image Obsidian embeds literal', () => {
    expect(parseNodeEmbeds('![[Note.md]] ![[file.pdf]]')).toEqual([
      expect.objectContaining({ kind: 'literal', syntax: '![[Note.md]]' }),
      expect.objectContaining({ kind: 'literal', syntax: '![[file.pdf]]' }),
    ]);
  });

  it('recognizes image extensions case-insensitively before query or fragment', () => {
    expect(parseNodeEmbeds('![[Photo.PNG#crop]]')[0]).toEqual(
      expect.objectContaining({ kind: 'image', target: 'Photo.PNG#crop' }),
    );
  });

  it('does not use Obsidian size aliases as alt text', () => {
    expect(firstImage('![[image.png|300x200]]')?.alt).toBe('');
  });
});
