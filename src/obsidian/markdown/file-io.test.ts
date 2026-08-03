import { describe, it, expect } from 'vitest';
import { joinLike } from './file-io';

describe('joinLike', () => {
  it('keeps the endings a note came with', () => {
    expect(joinLike(['a', 'b'], 'x\r\ny')).toBe('a\r\nb');
    expect(joinLike(['a', 'b'], 'x\ny')).toBe('a\nb');
  });

  it('takes a note with no ending at all for a plain one', () => {
    expect(joinLike(['only'], 'only')).toBe('only');
  });
});
