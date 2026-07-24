import { describe, it, expect } from 'vitest';
import { parseNodeText } from './node-text';

describe('parseNodeText', () => {
  it('returns a single text segment when there are no links', () => {
    expect(parseNodeText('just text')).toEqual([
      { kind: 'text', text: 'just text' },
    ]);
  });

  it('parses a wikilink, defaulting the label to the target', () => {
    expect(parseNodeText('[[Note]]')).toEqual([
      { kind: 'wikilink', target: 'Note', label: 'Note' },
    ]);
  });

  it('uses the alias as the wikilink label when present', () => {
    expect(parseNodeText('[[Note|shown]]')).toEqual([
      { kind: 'wikilink', target: 'Note', label: 'shown' },
    ]);
  });

  it('parses a markdown link into url and label', () => {
    expect(parseNodeText('[label](https://x.com)')).toEqual([
      { kind: 'link', url: 'https://x.com', label: 'label' },
    ]);
  });

  it('keeps surrounding text as its own segments, in order', () => {
    expect(parseNodeText('see [[A]] and [b](u) end')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'wikilink', target: 'A', label: 'A' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', url: 'u', label: 'b' },
      { kind: 'text', text: ' end' },
    ]);
  });

  it('trims whitespace inside wikilink target and alias', () => {
    expect(parseNodeText('[[ Note | shown ]]')).toEqual([
      { kind: 'wikilink', target: 'Note', label: 'shown' },
    ]);
  });
});
