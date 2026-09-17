import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  isNodeBookmark,
  NodeBookmark,
  nodeBookmarksFrom,
  renameBookmarkFiles,
  resolveAnchor,
  trackAnchor,
} from './bookmarks';
import { findByLine, parseMarkdown } from './parse/parser';

function nodeAt(markdown: string, line: number) {
  return findByLine(parseMarkdown(markdown, 'Note'), line)!;
}

describe('node bookmarks', () => {
  it('accepts only complete persisted bookmarks', () => {
    const bookmark: NodeBookmark = {
      id: 'saved',
      file: 'Note.md',
      name: null,
      type: 'list',
      text: 'target',
      line: 1,
      ancestors: ['Parent'],
      unresolved: false,
    };

    expect(isNodeBookmark(bookmark)).toBe(true);
    expect(isNodeBookmark({ ...bookmark, line: '1' })).toBe(false);
    expect(isNodeBookmark({ ...bookmark, ancestors: ['Parent', 2] })).toBe(
      false,
    );
    expect(nodeBookmarksFrom([bookmark, null, { ...bookmark, id: 3 }])).toEqual(
      [bookmark],
    );
    expect(nodeBookmarksFrom({ bookmark })).toEqual([]);
  });

  it('moves every bookmark inside a renamed folder', () => {
    const bookmark = (id: string, file: string): NodeBookmark => ({
      id,
      file,
      name: null,
      type: 'list',
      text: id,
      line: 0,
      ancestors: [],
      unresolved: false,
    });
    const bookmarks = [
      bookmark('one', 'Plans/One.md'),
      bookmark('two', 'Plans/One.md'),
      bookmark('three', 'Plans/Nested/Two.md'),
      bookmark('outside', 'Other.md'),
    ];

    expect(renameBookmarkFiles(bookmarks, 'Plans', 'Archive/Plans')).toBe(true);
    expect(bookmarks.map((item) => item.file)).toEqual([
      'Archive/Plans/One.md',
      'Archive/Plans/One.md',
      'Archive/Plans/Nested/Two.md',
      'Other.md',
    ]);
  });

  it('follows a node moved to another parent by its unique text', () => {
    const before = '# One\n- target\n# Two';
    const after = '# One\n# Two\n- target';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(resolveAnchor(parseMarkdown(after, 'Note'), anchor)?.line).toBe(2);
  });

  it('follows a rename at the same structural position', () => {
    const before = '# Parent\n- old name';
    const after = '# Parent\n- new name';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after)?.text,
    ).toBe('new name');
  });

  it('uses ancestors to distinguish duplicate text', () => {
    const before = '# One\n- target\n# Two\n- target';
    const after = '# Zero\n# One\n- target\n# Two\n- target';
    const anchor = anchorFor(nodeAt(before, 3));

    expect(resolveAnchor(parseMarkdown(after, 'Note'), anchor)?.line).toBe(4);
  });

  it('uses the saved line to distinguish identical siblings', () => {
    const markdown = '# Parent\n- same\n- same';
    const anchor = anchorFor(nodeAt(markdown, 2));

    expect(resolveAnchor(parseMarkdown(markdown, 'Note'), anchor)?.line).toBe(
      2,
    );
  });

  it('refuses a replacement on the old line under another parent', () => {
    const before = '# One\n- target';
    const after = '# Two\n- replacement';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(resolveAnchor(parseMarkdown(after, 'Note'), anchor)).toBeNull();
  });

  it('does not attach a deleted bookmark to the sibling shifted onto its line', () => {
    const before = '# Parent\n- target\n- other';
    const after = '# Parent\n- other';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('refuses shifted duplicates after the line count changes', () => {
    const before = '# Parent\n- same\n- same';
    const after = '# Parent\n- inserted\n- same\n- same';
    const anchor = anchorFor(nodeAt(before, 2));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('renames one duplicate without adopting the one left unchanged', () => {
    const before = '# Parent\n- same\n- same';
    const after = '# Parent\n- same\n- renamed';
    const anchor = anchorFor(nodeAt(before, 2));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after)?.text,
    ).toBe('renamed');
  });

  it('does not adopt a duplicate left after the bookmarked one is deleted', () => {
    const before = '# Parent\n- same\n- same';
    const after = '# Parent\n- same';
    const anchor = anchorFor(nodeAt(before, 2));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('does not attach when tracking starts from a revision missing the bookmark', () => {
    const bookmarked = '# Parent\n- target\n- other';
    const before = '# Parent\n- other';
    const after = '# Parent\n- other\nnew body';
    const anchor = anchorFor(nodeAt(bookmarked, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('does not map across a multi-line replacement of equal length', () => {
    const before = '# Parent\n- target\n- other';
    const after = '# Parent\n- other\n- added';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('refuses an equal-length replacement containing multiple nodes', () => {
    const before = '# Parent\n- target';
    const after = '# Renamed parent\n- renamed target';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toBeNull();
  });

  it('follows one renamed node when body text changes with it', () => {
    const before = '# Parent\n- target\n  old body';
    const after = '# Parent\n- renamed target\n  new body';
    const anchor = anchorFor(nodeAt(before, 1));

    expect(
      trackAnchor(parseMarkdown(after, 'Note'), anchor, before, after),
    ).toMatchObject({ text: 'renamed target', line: 1 });
  });
});
