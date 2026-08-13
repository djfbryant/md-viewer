import { describe, expect, it } from 'vitest';
import { getShareId, sharePath } from './document';

describe('document routes', () => {
  it('round-trips opaque IDs through a share path but rejects nested paths', () => {
    expect(getShareId(sharePath('opaque id'))).toBe('opaque id');
    expect(getShareId('/s/opaque-id/more')).toBeNull();
  });

  it('treats malformed percent encoding in a share path as unavailable', () => {
    expect(getShareId('/s/%')).toBeNull();
  });
});
