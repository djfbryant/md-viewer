import { describe, expect, it } from 'vitest';
import { sourceOffsetForEditorOffset } from './editor-position-sync';

describe('editor position offsets', () => {
  it('maps normalized textarea offsets back to CRLF Markdown offsets', () => {
    const source = 'first\r\nsecond\r\nthird';

    expect(sourceOffsetForEditorOffset(source, 0)).toBe(0);
    expect(sourceOffsetForEditorOffset(source, 'first\n'.length)).toBe('first\r\n'.length);
    expect(sourceOffsetForEditorOffset(source, source.replace(/\r\n/g, '\n').length)).toBe(source.length);
  });
});
