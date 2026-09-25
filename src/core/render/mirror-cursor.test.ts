import { describe, expect, it } from 'vitest';
import { mirrorCursorInBody } from './mirror-cursor';

describe('mirrorCursorInBody', () => {
  it('removes only the structural indent from a list continuation', () => {
    expect(
      mirrorCursorInBody('  edited note', 8, '  old note', 'old note'),
    ).toEqual({
      before: 'edited',
      after: ' note',
    });
  });

  it('keeps indentation that belongs to the body text', () => {
    expect(
      mirrorCursorInBody('      code', 8, '      code', '    code'),
    ).toEqual({
      before: '    co',
      after: 'de',
    });
  });

  it('never invents or writes text when the line indentation changes', () => {
    expect(mirrorCursorInBody('changed', 3, '  old', 'old')).toEqual({
      before: 'cha',
      after: 'nged',
    });
  });
});
