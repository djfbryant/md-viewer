import { describe, expect, it } from 'vitest';
import {
  editPath,
  privacyFor,
  PRIVATE_ROBOTS,
  PUBLIC_PREVIEW_DESCRIPTION,
  PUBLIC_PREVIEW_TITLE,
  PUBLIC_ROBOTS,
  recognizeRoute,
  REFERRER_POLICY,
  responseHeadersFor,
  robotsTxt,
  sharePath,
} from './navigation';

describe('document routes', () => {
  it('round-trips opaque share and edit IDs and keeps their capabilities distinct', () => {
    expect(sharePath('opaque id')).toBe('/s/opaque%20id');
    expect(recognizeRoute('/s/opaque%20id')).toEqual({ kind: 'share', documentId: 'opaque id' });
    expect(recognizeRoute(sharePath('opaque id'))).toEqual({ kind: 'share', documentId: 'opaque id' });
    expect(recognizeRoute(editPath('private edit'))).toEqual({ kind: 'edit', editId: 'private edit' });
    expect(recognizeRoute(sharePath('private edit'))).toEqual({ kind: 'share', documentId: 'private edit' });
    expect(recognizeRoute('/s/opaque-id/more')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/e/private-edit/more')).toEqual({ kind: 'unavailable' });
  });

  it('round-trips Instant-shaped share IDs and still treats a truncated token as a share route', () => {
    const documentId = '52567466-9a13-483a-9e62-335adaf3ca72';
    expect(recognizeRoute(sharePath(documentId))).toEqual({ kind: 'share', documentId });
    expect(recognizeRoute(`/s/${documentId.slice(0, 18)}`)).toEqual({
      kind: 'share',
      documentId: documentId.slice(0, 18),
    });
  });

  it('treats home and the new-document editor as exact paths', () => {
    expect(recognizeRoute('/')).toEqual({ kind: 'home' });
    expect(recognizeRoute('/new')).toEqual({ kind: 'editor' });
    expect(recognizeRoute('/new/')).toEqual({ kind: 'unavailable' });
  });

  it('recognises About, Privacy, and Acceptable use as public information paths', () => {
    expect(recognizeRoute('/about')).toEqual({ kind: 'info', page: 'about' });
    expect(recognizeRoute('/privacy')).toEqual({ kind: 'info', page: 'privacy' });
    expect(recognizeRoute('/acceptable-use')).toEqual({ kind: 'info', page: 'acceptable-use' });
    expect(recognizeRoute('/about/')).toEqual({ kind: 'info', page: 'about' });
    expect(recognizeRoute('/privacy/more')).toEqual({ kind: 'unavailable' });
  });

  it('treats malformed percent encoding and unknown paths as unavailable', () => {
    expect(recognizeRoute('/s/%')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/e/%')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/s/')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/e/')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/secret-notes')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/edit/private-edit')).toEqual({ kind: 'unavailable' });
  });

  it('keeps Share Links, Edit Links, the editor, and unknown paths out of indexes and referrers', () => {
    const share = privacyFor(recognizeRoute('/s/opaque-id'));
    expect(share).toEqual({
      pageTitle: PUBLIC_PREVIEW_TITLE,
      robots: PRIVATE_ROBOTS,
      referrer: REFERRER_POLICY,
      previewTitle: PUBLIC_PREVIEW_TITLE,
      previewDescription: PUBLIC_PREVIEW_DESCRIPTION,
    });
    expect(share.previewTitle).not.toContain('opaque-id');
    expect(privacyFor(recognizeRoute('/e/private-edit')).robots).toBe(PRIVATE_ROBOTS);
    expect(privacyFor(recognizeRoute('/new')).robots).toBe(PRIVATE_ROBOTS);
    expect(privacyFor(recognizeRoute('/secret-notes')).robots).toBe(PRIVATE_ROBOTS);
    expect(privacyFor(recognizeRoute('/')).robots).toBe(PUBLIC_ROBOTS);
    expect(privacyFor(recognizeRoute('/about')).robots).toBe(PUBLIC_ROBOTS);
    expect(privacyFor(recognizeRoute('/about'), { about: 'About MarkShare', privacy: 'Privacy', 'acceptable-use': 'Acceptable use' }).pageTitle).toBe('About MarkShare · MarkShare');
    expect(privacyFor(recognizeRoute('/privacy')).robots).toBe(PUBLIC_ROBOTS);
    expect(privacyFor(recognizeRoute('/acceptable-use')).robots).toBe(PUBLIC_ROBOTS);
  });

  it('emits generic preview headers for Share Links and never content-derived values', () => {
    expect(responseHeadersFor('/s/opaque-id')).toEqual([
      { key: 'X-Robots-Tag', value: PRIVATE_ROBOTS },
      { key: 'Referrer-Policy', value: REFERRER_POLICY },
    ]);
    expect(responseHeadersFor('/e/private-edit')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/new')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/secret-notes')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/')).toEqual([
      { key: 'X-Robots-Tag', value: PUBLIC_ROBOTS },
      { key: 'Referrer-Policy', value: REFERRER_POLICY },
    ]);
    expect(responseHeadersFor('/about')).toEqual(responseHeadersFor('/'));
    expect(JSON.stringify(responseHeadersFor('/s/secret-notes'))).not.toMatch(/secret-notes/i);
  });

  it('tells crawlers not to fetch Share Links, Edit Links, or the editor', () => {
    expect(robotsTxt()).toBe('User-agent: *\nAllow: /\nDisallow: /s/\nDisallow: /e/\nDisallow: /new\n');
  });
});
