import { describe, it, expect } from 'vitest';
import { multiLineValue, singleLineValue } from './edit-value';

describe('singleLineValue', () => {
  it('flattens pasted line breaks and trims the ends', () => {
    expect(singleLineValue('  a\nb  ')).toBe('a b');
    expect(singleLineValue('a\r\n\r\nb')).toBe('a b');
  });
});

describe('multiLineValue', () => {
  it('keeps the indent of the first line', () => {
    // The line the caret starts on can be the deepest one; trimming the value
    // as a single string would flatten the block it belongs to.
    expect(multiLineValue('    code\nplain')).toBe('    code\nplain');
  });

  it('drops blank lines at the top and whitespace at the end', () => {
    expect(multiLineValue('\n \n  text\n\n  ')).toBe('  text');
  });

  it('keeps a blank line between paragraphs', () => {
    expect(multiLineValue('one\n\ntwo')).toBe('one\n\ntwo');
  });

  it('drops carriage returns, wherever they come from', () => {
    expect(multiLineValue('one\r\ntwo')).toBe('one\ntwo');
  });
});
