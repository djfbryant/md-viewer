import { describe, expect, it } from 'vitest';
import {
  documentImagePath,
  liveDocumentImageCount,
  referencedDocumentImageIds,
  removedImagePlaceholder,
  rewriteRemovedImageRefs,
} from './document-image';

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

  it('collects markshare-image ids when the destination has a Markdown title', () => {
    expect(referencedDocumentImageIds('![sketch](markshare-image:kept "Sketch")')).toEqual(new Set(['kept']));
    expect(referencedDocumentImageIds("![sketch](markshare-image:kept 'Sketch')")).toEqual(new Set(['kept']));
  });

  it('rewrites removed image refs to emphasis placeholders and ignores live refs', () => {
    const source = '# Notes\n\n![gone.png](markshare-image:gone)\n\n![live.png](markshare-image:live)';
    expect(rewriteRemovedImageRefs(source, new Set(['gone']))).toBe(
      `# Notes\n\n${removedImagePlaceholder('gone.png')}\n\n![live.png](markshare-image:live)`,
    );
  });

  it('counts only referenced live stored and pending images', () => {
    const markdown = '![a](markshare-image:a)\n![b](markshare-image:b)\n![c](markshare-image:c)';
    expect(liveDocumentImageCount(markdown, ['a', 'b'], ['c'])).toBe(3);
    expect(liveDocumentImageCount(markdown, ['a'], ['c'])).toBe(2);
    expect(liveDocumentImageCount(markdown, [], ['c'])).toBe(1);
    expect(liveDocumentImageCount(markdown, ['a', 'b'], [])).toBe(2);
  });
});
