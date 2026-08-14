import { describe, expect, it } from 'vitest';
import { editPath, recognizeRoute, sharePath } from './navigation';

describe('document routes', () => {
  it('round-trips opaque share and edit IDs and keeps their capabilities distinct', () => {
    expect(recognizeRoute(sharePath('opaque id'))).toEqual({ kind: 'share', documentId: 'opaque id' });
    expect(recognizeRoute(editPath('private edit'))).toEqual({ kind: 'edit', editId: 'private edit' });
    expect(recognizeRoute(sharePath('private edit'))).toEqual({ kind: 'share', documentId: 'private edit' });
    expect(recognizeRoute('/s/opaque-id/more')).toEqual({ kind: 'unavailable' });
    expect(recognizeRoute('/e/private-edit/more')).toEqual({ kind: 'unavailable' });
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
});
