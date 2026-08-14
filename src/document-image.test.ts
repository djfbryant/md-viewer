import { describe, expect, it } from 'vitest';
import { documentImagePath, referencedDocumentImageIds } from './document-image';

describe('document image references', () => {
  it('stores pasted images under documents/{documentId}/{imageId}', () => {
    expect(documentImagePath('doc-id', 'image-id')).toBe('documents/doc-id/image-id');
  });

  it('collects markshare-image ids still present in markdown', () => {
    expect(referencedDocumentImageIds('# Notes\n\n![a](markshare-image:kept)\n![b](markshare-image:also-kept)')).toEqual(
      new Set(['kept', 'also-kept']),
    );
    expect(referencedDocumentImageIds('# Notes')).toEqual(new Set());
    expect(referencedDocumentImageIds('![gone](https://example.com/x.png)')).toEqual(new Set());
  });
});
