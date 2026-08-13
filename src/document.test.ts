import { describe, expect, it } from 'vitest';
import { documentTitle, getShareId, sharePath } from './document';

describe('document routes and titles', () => {
  it('derives a title only from the first level-one heading', () => {
    expect(documentTitle('intro\n## Not a title\n# Actual title')).toBe('Actual title');
    expect(documentTitle('no heading')).toBe('Untitled document');
  });

  it('round-trips opaque IDs through a share path but rejects nested paths', () => {
    expect(getShareId(sharePath('opaque id'))).toBe('opaque id');
    expect(getShareId('/s/opaque-id/more')).toBeNull();
  });

  it('treats malformed percent encoding in a share path as unavailable', () => {
    expect(getShareId('/s/%')).toBeNull();
  });
});
