import { describe, expect, it } from 'vitest';
import {
  deleteAutoOpen,
  OpenMarkdownFiles,
  rememberAutoOpen,
  renameAutoOpen,
} from './auto-open';

describe('remembered auto-open maps', () => {
  it('remembers a note only once', () => {
    expect(rememberAutoOpen(['One.md'], 'Two.md')).toEqual([
      'One.md',
      'Two.md',
    ]);
    expect(rememberAutoOpen(['One.md'], 'One.md')).toEqual(['One.md']);
  });

  it('follows file and folder moves without matching a path prefix', () => {
    expect(
      renameAutoOpen(
        ['Old.md', 'Folder/One.md', 'Folderish/Two.md'],
        'Old.md',
        'Moved.md',
      ),
    ).toEqual(['Moved.md', 'Folder/One.md', 'Folderish/Two.md']);
    expect(
      renameAutoOpen(
        ['Folder/One.md', 'Folder/Deep/Two.md', 'Folderish/Three.md'],
        'Folder',
        'Moved',
      ),
    ).toEqual(['Moved/One.md', 'Moved/Deep/Two.md', 'Folderish/Three.md']);
    expect(
      renameAutoOpen(['Moved.md', 'Old.md'], 'Old.md', 'Moved.md'),
    ).toEqual(['Moved.md']);
  });

  it('forgets deleted files and folders only', () => {
    expect(
      deleteAutoOpen(
        ['Folder/One.md', 'Folder/Deep/Two.md', 'Folderish/Three.md'],
        'Folder',
      ),
    ).toEqual(['Folderish/Three.md']);
  });

  it('only calls a file newly opened while it has no Markdown tab', () => {
    const open = new OpenMarkdownFiles(['Already.md']);

    expect(open.open('Already.md')).toBe(false);
    expect(open.open('New.md')).toBe(true);
    expect(open.open('New.md')).toBe(false);

    open.retain(['Already.md']);
    expect(open.open('New.md')).toBe(true);

    open.rename('Already.md', 'Moved.md');
    expect(open.open('Moved.md')).toBe(false);
    expect(open.open('Already.md')).toBe(true);
  });
});
