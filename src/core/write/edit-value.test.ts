import { describe, it, expect } from 'vitest';
import { singleLineValue } from './edit-value';

describe('singleLineValue', () => {
  it('flattens pasted line breaks and trims the ends', () => {
    expect(singleLineValue('  a\nb  ')).toBe('a b');
    expect(singleLineValue('a\r\n\r\nb')).toBe('a b');
  });
});
