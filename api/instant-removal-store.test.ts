import { describe, expect, it } from 'vitest';
import { ownedFiles } from './instant-removal-store';

describe('Instant removal image mapping', () => {
  it('keeps the Instant file record ID separate from the Markdown image ID', () => {
    const owned = ownedFiles('doc-id', [
      { id: 'file-record-uuid', path: 'documents/doc-id/sketch', expiresAt: '2026-08-20T12:00:00.000Z' },
      { id: 'other-file', path: 'documents/other-doc/sketch' },
    ]);

    // The Markdown image id keys the map; the Instant storage id is the value that
    // stays behind this adapter, and the wire date is resolved on the way through.
    expect([...owned.keys()]).toEqual(['sketch']);
    expect(owned.get('sketch')).toEqual({
      fileId: 'file-record-uuid',
      expiresAt: new Date('2026-08-20T12:00:00.000Z'),
    });
  });

  it('leaves an image with no retention date undated rather than guessing one', () => {
    expect(ownedFiles('doc-id', [{ id: 'file-record-uuid', path: 'documents/doc-id/legacy' }]).get('legacy')).toEqual({
      fileId: 'file-record-uuid',
      expiresAt: null,
    });
  });
});
