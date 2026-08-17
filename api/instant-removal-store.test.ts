import { describe, expect, it } from 'vitest';
import { ownedImages } from './instant-removal-store';

describe('Instant removal image mapping', () => {
  it('keeps the Instant file record ID separate from the Markdown image ID', () => {
    expect(ownedImages('doc-id', [
      { id: 'file-record-uuid', path: 'documents/doc-id/sketch', expiresAt: '2026-08-20T12:00:00.000Z' },
      { id: 'other-file', path: 'documents/other-doc/sketch' },
    ])).toEqual([
      { id: 'sketch', fileId: 'file-record-uuid', expiresAt: '2026-08-20T12:00:00.000Z' },
    ]);
  });
});
