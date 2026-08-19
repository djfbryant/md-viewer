import { describe, expect, it } from 'vitest';
import {
  documentPath,
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
  it('round-trips opaque share IDs and signed-in document paths', () => {
    expect(sharePath('opaque id')).toBe('/s/opaque%20id');
    expect(recognizeRoute('/s/opaque%20id')).toEqual({ kind: 'share', documentId: 'opaque id' });
    expect(recognizeRoute(sharePath('opaque id'))).toEqual({ kind: 'share', documentId: 'opaque id' });
    expect(recognizeRoute(documentPath('opaque id'))).toEqual({ kind: 'document', documentId: 'opaque id' });
    expect(recognizeRoute(sharePath('private edit'))).toEqual({ kind: 'share', documentId: 'private edit' });
    expect(recognizeRoute('/s/opaque-id/more')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/e/private-edit')).toEqual({ kind: 'unavailable' });
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

  it('treats home, sign-in, and the new-document editor as exact paths', () => {
    expect(recognizeRoute('/')).toEqual({ kind: 'home' });
    expect(recognizeRoute('/sign-in')).toEqual({ kind: 'sign-in' });
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
    expect(recognizeRoute('/d/%')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/s/')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/d/')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/secret-notes')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/edit/private-edit')).toEqual({ kind: 'unavailable' });
  });

  it('keeps Share Links, the editor, sign-in, and unknown paths out of indexes and referrers', () => {
    const share = privacyFor(recognizeRoute('/s/opaque-id'));
    expect(share).toEqual({
      pageTitle: PUBLIC_PREVIEW_TITLE,
      robots: PRIVATE_ROBOTS,
      referrer: REFERRER_POLICY,
      previewTitle: PUBLIC_PREVIEW_TITLE,
      previewDescription: PUBLIC_PREVIEW_DESCRIPTION,
    });
    expect(share.previewTitle).not.toContain('opaque-id');
    expect(privacyFor(recognizeRoute('/d/opaque-id')).robots).toBe(PRIVATE_ROBOTS);
    expect(privacyFor(recognizeRoute('/new')).robots).toBe(PRIVATE_ROBOTS);
    expect(privacyFor(recognizeRoute('/sign-in')).robots).toBe(PRIVATE_ROBOTS);
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
    expect(responseHeadersFor('/d/opaque-id')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/e/private-edit')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/new')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/sign-in')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/secret-notes')).toEqual(responseHeadersFor('/s/opaque-id'));
    expect(responseHeadersFor('/')).toEqual([
      { key: 'X-Robots-Tag', value: PUBLIC_ROBOTS },
      { key: 'Referrer-Policy', value: REFERRER_POLICY },
    ]);
    expect(responseHeadersFor('/about')).toEqual(responseHeadersFor('/'));
    expect(JSON.stringify(responseHeadersFor('/s/secret-notes'))).not.toMatch(/secret-notes/i);
  });

  it('tells crawlers not to fetch Share Links, the editor, or sign-in', () => {
    expect(robotsTxt()).toBe('User-agent: *\nAllow: /\nDisallow: /s/\nDisallow: /d/\nDisallow: /e/\nDisallow: /new\nDisallow: /sign-in\n');
  });
});
