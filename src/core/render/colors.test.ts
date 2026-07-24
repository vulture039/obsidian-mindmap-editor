import { describe, it, expect } from 'vitest';
import { branchColorFor, DEFAULT_PALETTE, parsePalette } from './colors';

describe('parsePalette', () => {
  it('reads one trimmed color per non-empty line', () => {
    expect(parsePalette('#111\n  #222  \n\n#333\n')).toEqual([
      '#111',
      '#222',
      '#333',
    ]);
  });

  it('falls back to the default palette when empty', () => {
    expect(parsePalette('')).toBe(DEFAULT_PALETTE);
    expect(parsePalette('   \n  \n')).toBe(DEFAULT_PALETTE);
  });
});

describe('branchColorFor', () => {
  it('cycles through the palette by position', () => {
    const palette = ['#a', '#b', '#c'];

    expect(branchColorFor(0, palette)).toBe('#a');
    expect(branchColorFor(2, palette)).toBe('#c');
    expect(branchColorFor(3, palette)).toBe('#a');
    expect(branchColorFor(4, palette)).toBe('#b');
  });
});
