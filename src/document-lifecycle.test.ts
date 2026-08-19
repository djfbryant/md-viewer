import { describe, expect, it, vi } from 'vitest';
import { imageExpiresAt, MAX_IMAGE_BYTES } from './document-image';
import {
  createDocumentCleanup,
  createDocumentLifecycle,
  createLocalStorageAbuseStore,
  createMemoryAbuseStore,
  type DocumentPersistence,
} from './document-lifecycle';
import { createMemoryDocumentStore } from './test/memory-document-store';

const unusedPersistence = {
  useCreatorLibrary: () => ({ loading: false, owned: [], granted: [] }),
  useClubCreators: () => [],
  grantEditor: async () => 'granted' as const,
  revokeEditor: async () => 'revoked' as const,
  findCreatorUserId: async () => null,
};

const unavailable = { kind: 'unavailable' as const };

describe('Document lifecycle', () => {
  it('publishes a titled document that a holder of its share ID can read', async () => {
    const persistence = createMemoryDocumentStore();
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id', () => new Date('2026-08-13T12:00:00Z'));

    const published = await lifecycle.save('# Release notes\n\nHello **reader**.', undefined, undefined, 'owner-user');

    expect(published).toEqual({
      kind: 'published',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
  });

  it('returns an unavailable outcome for an unknown share ID', () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');
    expect(lifecycle.useShareDocument('unknown')).toEqual(unavailable);
  });

  it('rate-limits public creation and image upload without publishing', async () => {
    const store = createMemoryDocumentStore();
    const png = (id: string) => ({ id, file: new File(['x'], `${id}.png`, { type: 'image/png' }) });
    const createIds = ['one-id', 'one-edit', 'two-id', 'two-edit', 'three-id', 'three-edit'];
    const lifecycle = createDocumentLifecycle(store, () => createIds.shift()!, () => new Date('2026-08-13T12:00:00Z'), {
      create: { max: 2, windowMs: 60 * 60 * 1000 },
      upload: { max: 2, windowMs: 60 * 60 * 1000 },
    });

    await expect(lifecycle.save('# One')).resolves.toMatchObject({ kind: 'published' });
    await expect(lifecycle.save('# Two')).resolves.toMatchObject({ kind: 'published' });
    await expect(lifecycle.save('# Three')).resolves.toEqual({ kind: 'rate-limited', limit: 'create' });
    expect(store.documents.size).toBe(2);
    await expect(lifecycle.save('# Illustrated', undefined, { images: [png('a'), png('b')] })).resolves.toEqual({
      kind: 'rate-limited',
      limit: 'create',
    });

    const ids = ['keep-id', 'keep-edit'];
    const revision = createDocumentLifecycle(store, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'), {
      create: { max: 20, windowMs: 60 * 60 * 1000 },
      upload: { max: 2, windowMs: 60 * 60 * 1000 },
    });
    const published = await revision.save('# Keep');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    await expect(revision.save('# Keep\n\n![one](markshare-image:one)\n\n![two](markshare-image:two)', published.document, { images: [png('one'), png('two')] })).resolves.toMatchObject({ kind: 'published' });
    await expect(revision.save('# Keep\n\n![three](markshare-image:three)', published.document, { images: [png('three')] })).resolves.toEqual({ kind: 'rate-limited', limit: 'upload' });
    expect(store.images.get(published.document.id)).toHaveLength(2);
  });

  it('allows another create after the rate-limit window elapses', async () => {
    const store = createMemoryDocumentStore();
    let now = new Date('2026-08-13T12:00:00Z');
    const ids = ['first-id', 'first-edit', 'later-id', 'later-edit'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now, {
      create: { max: 1, windowMs: 60 * 60 * 1000 },
      upload: { max: 1, windowMs: 60 * 60 * 1000 },
    });

    await expect(lifecycle.save('# First')).resolves.toMatchObject({ kind: 'published' });
    await expect(lifecycle.save('# Blocked')).resolves.toEqual({ kind: 'rate-limited', limit: 'create' });
    now = new Date('2026-08-13T13:00:00Z');
    await expect(lifecycle.save('# Later')).resolves.toMatchObject({ kind: 'published', document: { markdown: '# Later' } });
  });

  it('keeps the create quota in a storage-backed abuse store after a new lifecycle', async () => {
    const memory = new Map<string, string>();
    const abuse = createLocalStorageAbuseStore({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
    });
    const limits = { create: { max: 1, windowMs: 60 * 60 * 1000 }, upload: { max: 1, windowMs: 60 * 60 * 1000 } };
    const first = createDocumentLifecycle(createMemoryDocumentStore(), () => 'first-id', () => new Date('2026-08-13T12:00:00Z'), limits, abuse);
    await expect(first.save('# First')).resolves.toMatchObject({ kind: 'published' });

    const second = createDocumentLifecycle(createMemoryDocumentStore(), () => 'second-id', () => new Date('2026-08-13T12:00:00Z'), limits, createLocalStorageAbuseStore({
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => { memory.set(key, value); },
    }));
    await expect(second.save('# Second')).resolves.toEqual({ kind: 'rate-limited', limit: 'create' });
  });

  it('keeps the create quota across a new lifecycle that shares the abuse store', async () => {
    const documents = createMemoryDocumentStore();
    const abuse = createMemoryAbuseStore();
    const limits = { create: { max: 1, windowMs: 60 * 60 * 1000 }, upload: { max: 1, windowMs: 60 * 60 * 1000 } };
    const first = createDocumentLifecycle(documents, () => 'first-id', () => new Date('2026-08-13T12:00:00Z'), limits, abuse);
    await expect(first.save('# First')).resolves.toMatchObject({ kind: 'published' });

    const second = createDocumentLifecycle(documents, () => 'second-id', () => new Date('2026-08-13T12:00:00Z'), limits, abuse);
    await expect(second.save('# Second')).resolves.toEqual({ kind: 'rate-limited', limit: 'create' });
    expect(documents.documents.size).toBe(1);
  });

  it('does not consume quota when validation or persistence fails', async () => {
    const limits = { create: { max: 1, windowMs: 60 * 60 * 1000 }, upload: { max: 1, windowMs: 60 * 60 * 1000 } };
    const abuse = createMemoryAbuseStore();
    const store = createMemoryDocumentStore();
    let persist: 'fail' | 'ok' = 'fail';
    const persistence: DocumentPersistence = {
      ...store,
      async save(document) {
        if (persist === 'fail') throw new Error('persist failed');
        return store.save(document);
      },
    };
    const ids = ['fail-id', 'fail-edit', 'ok-id', 'ok-edit', 'blocked-id', 'blocked-edit'];
    const lifecycle = createDocumentLifecycle(persistence, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'), limits, abuse);

    await expect(lifecycle.save('# Notes')).resolves.toEqual({ kind: 'failed' });
    persist = 'ok';
    await expect(lifecycle.save('# Notes')).resolves.toMatchObject({ kind: 'published' });
    await expect(lifecycle.save('# Blocked')).resolves.toEqual({ kind: 'rate-limited', limit: 'create' });

    const uploads = createDocumentLifecycle(createMemoryDocumentStore(), () => 'doc-id', () => new Date('2026-08-13T12:00:00Z'), limits);
    const oversized = { id: 'huge', file: new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' }) };
    Object.defineProperty(oversized.file, 'size', { value: MAX_IMAGE_BYTES + 1 });
    await expect(uploads.save('# Huge\n\n![huge](markshare-image:huge)', undefined, { images: [oversized] })).resolves.toEqual({ kind: 'failed' });
    await expect(uploads.save('# Ok\n\n![ok](markshare-image:ok)', undefined, {
      images: [{ id: 'ok', file: new File(['x'], 'ok.png', { type: 'image/png' }) }],
    })).resolves.toMatchObject({ kind: 'published' });
  });

  it('translates a persistence failure to a generic publish failure', async () => {
    const persistence: DocumentPersistence = {
      save: vi.fn().mockRejectedValue(new Error('network error')),
      uploadImage: vi.fn(),
      removeImages: vi.fn(),
      listImages: vi.fn().mockResolvedValue([]),
      useShareDocument: () => unavailable,
      useEditDocument: () => unavailable,
      markDeleted: vi.fn(),
      ...unusedPersistence,
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('Text')).resolves.toEqual({ kind: 'failed' });
  });

  it('keeps a missing database configuration distinct from a failed publish', async () => {
    const lifecycle = createDocumentLifecycle({
      save: async () => 'not-configured',
      uploadImage: async () => 'not-configured',
      removeImages: async () => undefined,
      listImages: async () => [],
      useShareDocument: () => unavailable,
      useEditDocument: () => unavailable,
      markDeleted: async () => 'not-configured',
      ...unusedPersistence,
    }, () => 'opaque-document-id');

    await expect(lifecycle.save('Text')).resolves.toEqual({ kind: 'not-configured' });
  });

  it('updates the existing document when the owner saves a revision', async () => {
    const persistence = createMemoryDocumentStore();
    const timestamps = [new Date('2026-08-13T12:00:00Z'), new Date('2026-08-13T13:00:00Z')];
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id', () => timestamps.shift()!);
    const first = await lifecycle.save('# First version');
    if (first.kind !== 'published') throw new Error('Expected initial save to succeed');

    const revised = await lifecycle.save('# Revised version', first.document);

    expect(revised).toMatchObject({ kind: 'published', document: { id: 'opaque-document-id', markdown: '# Revised version' } });
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Revised version', markdown: '# Revised version' },
    });
    expect(persistence.documents.get('opaque-document-id')).toMatchObject({
      createdAt: new Date('2026-08-13T12:00:00Z'),
      updatedAt: new Date('2026-08-13T13:00:00Z'),
    });
  });

  it('never expires a document by default, even far after publication', async () => {
    let now = new Date('2026-08-13T12:00:00.000Z');
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id', () => now);
    await lifecycle.save('# Lasts forever');

    now = new Date('2027-08-13T12:00:00.000Z');
    expect(lifecycle.useShareDocument('opaque-document-id')).toMatchObject({
      kind: 'available',
      document: { id: 'opaque-document-id', markdown: '# Lasts forever' },
    });
  });

  it('becomes unavailable at the exact configured expiry instant', async () => {
    const expiry = new Date('2026-08-14T18:00:00.000Z');
    let now = new Date('2026-08-13T12:00:00.000Z');
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id', () => now);

    await lifecycle.save('# Timed notes', undefined, { expiresAt: expiry });

    now = new Date(expiry.getTime() - 1);
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Timed notes', markdown: '# Timed notes', expiresAt: expiry },
    });

    now = new Date(expiry.getTime());
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual(unavailable);
  });

  it('keeps a configured expiry when a later save omits it', async () => {
    const expiry = new Date('2026-08-14T18:00:00.000Z');
    let now = new Date('2026-08-13T12:00:00Z');
    const store = createMemoryDocumentStore();
    const lifecycle = createDocumentLifecycle(store, () => 'opaque-document-id', () => now);
    const first = await lifecycle.save('# Timed notes', undefined, { expiresAt: expiry });
    if (first.kind !== 'published') throw new Error('Expected initial save to succeed');

    now = new Date('2026-08-13T13:00:00Z');
    await lifecycle.save('# Timed notes\n\nStill timed.', first.document);

    expect(store.documents.get('opaque-document-id')?.expiresAt).toEqual(expiry);
    expect(lifecycle.useShareDocument('opaque-document-id')).toMatchObject({
      kind: 'available',
      document: { markdown: '# Timed notes\n\nStill timed.', expiresAt: expiry },
    });
  });

  it('returns the same unavailable outcome for missing, expired, and deleted documents', async () => {
    const expiry = new Date('2026-08-14T18:00:00.000Z');
    let now = new Date('2026-08-13T12:00:00.000Z');
    const ids = ['live-id', 'live-edit', 'expired-id', 'expired-edit', 'deleted-id', 'deleted-edit'];
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => ids.shift()!, () => now);

    await lifecycle.save('# Live');
    const expired = await lifecycle.save('# Expired', undefined, { expiresAt: expiry });
    const deleted = await lifecycle.save('# Deleted');
    if (expired.kind !== 'published' || deleted.kind !== 'published') throw new Error('Expected saves to succeed');

    await lifecycle.delete(deleted.document);
    now = expiry;

    expect(lifecycle.useShareDocument('missing-id')).toEqual(unavailable);
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);
    expect(lifecycle.useShareDocument(deleted.document.id)).toEqual(unavailable);
  });

  it('removes expired documents and their images through the shared cleanup path', async () => {
    const expiry = new Date('2026-08-14T18:00:00.000Z');
    let now = new Date('2026-08-13T12:00:00.000Z');
    const store = createMemoryDocumentStore();
    const ids = ['keep-id', 'keep-edit', 'drop-id', 'drop-edit'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now);
    const cleanup = createDocumentCleanup(store, () => now);

    const kept = await lifecycle.save('# Keep');
    const expired = await lifecycle.save('# Drop', undefined, { expiresAt: expiry });
    if (kept.kind !== 'published' || expired.kind !== 'published') throw new Error('Expected saves to succeed');
    store.addImage(kept.document.id, 'keep-image');
    store.addImage(expired.document.id, 'drop-image-1');
    store.addImage(expired.document.id, 'drop-image-2');

    now = expiry;
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);

    await expect(cleanup()).resolves.toEqual({
      kind: 'cleaned',
      removed: [{ documentId: expired.document.id, imageCount: 2 }],
      expiredImages: [],
    });
    expect(lifecycle.useShareDocument(kept.document.id)).toMatchObject({ kind: 'available', document: { id: kept.document.id } });
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);
    expect(store.images.get(kept.document.id)).toEqual(['keep-image']);
    expect(store.images.has(expired.document.id)).toBe(false);
    expect(store.documents.has(expired.document.id)).toBe(false);
  });

  it('separates a deployment with no removal credentials from a failed cleanup', async () => {
    await expect(createDocumentCleanup(null)()).resolves.toEqual({ kind: 'not-configured' });
  });

  it('makes a deleted document unavailable immediately and cleanup removes it with its images', async () => {
    const store = createMemoryDocumentStore();
    const now = () => new Date('2026-08-13T12:00:00Z');
    const lifecycle = createDocumentLifecycle(store, () => 'opaque-document-id', now);
    const cleanup = createDocumentCleanup(store, now);
    const published = await lifecycle.save('# Remove me');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    store.addImage(published.document.id, 'pasted-image');

    await expect(lifecycle.delete(published.document)).resolves.toEqual({ kind: 'deleted' });
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
    expect(store.documents.has(published.document.id)).toBe(true);
    expect(store.images.get(published.document.id)).toEqual(['pasted-image']);

    await expect(cleanup()).resolves.toEqual({
      kind: 'cleaned',
      removed: [{ documentId: published.document.id, imageCount: 1 }],
      expiredImages: [],
    });
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
    expect(store.documents.has(published.document.id)).toBe(false);
    expect(store.images.has(published.document.id)).toBe(false);
  });

  it('lets the owner open the saved document for edit without exposing role on the share outcome', async () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');
    await lifecycle.save('# Release notes\n\nHello **reader**.', undefined, undefined, 'owner-user');

    expect(lifecycle.useEditDocument('opaque-document-id', 'owner-user')).toEqual({
      kind: 'available',
      document: {
        id: 'opaque-document-id',
        title: 'Release notes',
        markdown: '# Release notes\n\nHello **reader**.',
        role: 'owner',
        editors: [],
      },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
    expect(lifecycle.useEditDocument('opaque-document-id', 'stranger-user')).toEqual(unavailable);
    expect(lifecycle.useEditDocument('opaque-document-id', null)).toEqual(unavailable);
    expect(lifecycle.useEditDocument('', 'owner-user')).toEqual(unavailable);
  });

  it('attaches a supported image as a document-scoped markdown reference', () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'pasted-image');

    expect(lifecycle.attachImage({ name: 'sketch.png', type: 'image/png', size: 12 }, 0)).toEqual({
      kind: 'attached',
      image: { id: 'pasted-image', markdown: '![sketch.png](markshare-image:pasted-image)' },
    });
  });

  it('rejects unsupported types, oversized files, and a seventh image', () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'image-id');

    expect(lifecycle.attachImage({ name: 'notes.pdf', type: 'application/pdf', size: 12 }, 0)).toEqual({ kind: 'unsupported' });
    expect(lifecycle.attachImage({ name: 'huge.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 }, 0)).toEqual({ kind: 'too-large' });
    expect(lifecycle.attachImage({ name: 'ok.png', type: 'image/png', size: 12 }, 6)).toEqual({ kind: 'too-many' });
    expect(lifecycle.attachImage({ name: 'ok.webp', type: 'image/webp', size: MAX_IMAGE_BYTES }, 5)).toMatchObject({ kind: 'attached' });
  });

  it('rejects publishing an image that exceeds the lifecycle limits', async () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');

    const huge = { id: 'huge', file: new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' }) };
    Object.defineProperty(huge.file, 'size', { value: MAX_IMAGE_BYTES + 1 });
    await expect(lifecycle.save('# Notes\n\n![huge](markshare-image:huge)', undefined, {
      images: [huge],
    })).resolves.toEqual({ kind: 'failed' });
    await expect(lifecycle.save('# Notes\n\n![pdf](markshare-image:pdf)', undefined, {
      images: [{ id: 'pdf', file: new File(['x'], 'notes.pdf', { type: 'application/pdf' }) }],
    })).resolves.toEqual({ kind: 'failed' });
  });

  it('rejects a seventh image at save, including additions to an existing document', async () => {
    const png = (id: string) => ({ id, file: new File(['x'], `${id}.png`, { type: 'image/png' }) });
    const store = createMemoryDocumentStore();
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!);

    await expect(lifecycle.save(
      Array.from({ length: 7 }, (_, index) => `![img-${index}](markshare-image:batch-${index})`).join('\n\n'),
      undefined,
      { images: Array.from({ length: 7 }, (_, index) => png(`batch-${index}`)) },
    )).resolves.toEqual({ kind: 'failed' });
    expect(store.images.size).toBe(0);

    const published = await lifecycle.save(
      Array.from({ length: 6 }, (_, index) => `![kept-${index}](markshare-image:kept-${index})`).join('\n\n'),
      undefined,
      { images: Array.from({ length: 6 }, (_, index) => png(`kept-${index}`)) },
    );
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    const sixRefs = Array.from({ length: 6 }, (_, index) => `![kept-${index}](markshare-image:kept-${index})`).join('\n\n');
    await expect(lifecycle.save(`${sixRefs}\n\n![extra](markshare-image:extra)`, published.document, { images: [png('extra')] })).resolves.toEqual({ kind: 'failed' });
    expect(store.images.get(published.document.id)).toHaveLength(6);
  });

  it('fails save without publishing when image create is denied', async () => {
    const store = createMemoryDocumentStore();
    const persistence: DocumentPersistence = {
      ...store,
      uploadImage: async () => {
        throw new Error('Permission denied: not has-storage-permission?');
      },
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes\n\n![pasted-image](markshare-image:pasted-image)', undefined, {
      images: [{ id: 'pasted-image', file: new File(['x'], 'sketch.png', { type: 'image/png' }) }],
    })).resolves.toEqual({ kind: 'failed' });
    expect(store.documents.size).toBe(0);
    expect(store.images.size).toBe(0);
  });

  it('removes uploaded images when a later persist fails', async () => {
    const store = createMemoryDocumentStore();
    const persistence: DocumentPersistence = {
      ...store,
      save: async () => {
        throw new Error('persist failed');
      },
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes', undefined, {
      images: [{ id: 'pasted-image', file: new File(['x'], 'sketch.png', { type: 'image/png' }) }],
    })).resolves.toEqual({ kind: 'failed' });
    expect(store.images.size).toBe(0);
    expect(store.imageUrls.size).toBe(0);
  });

  it('removes earlier images when a later upload fails', async () => {
    const store = createMemoryDocumentStore();
    let uploads = 0;
    const persistence: DocumentPersistence = {
      ...store,
      uploadImage: async (documentId, image, expiresAt) => {
        uploads += 1;
        if (uploads === 2) throw new Error('upload failed');
        return store.uploadImage(documentId, image, expiresAt);
      },
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes\n\n![first-image](markshare-image:first-image)\n\n![second-image](markshare-image:second-image)', undefined, {
      images: [
        { id: 'first-image', file: new File(['x'], 'first.png', { type: 'image/png' }) },
        { id: 'second-image', file: new File(['x'], 'second.png', { type: 'image/png' }) },
      ],
    })).resolves.toEqual({ kind: 'failed' });
    expect(store.images.size).toBe(0);
    expect(store.imageUrls.size).toBe(0);
  });

  it('publishes pasted images and serves their sources only while the document is available', async () => {
    const store = createMemoryDocumentStore();
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'));
    const image = { id: 'pasted-image', file: new Blob(['png'], { type: 'image/png' }) };

    const published = await lifecycle.save('# Notes\n\n![sketch.png](markshare-image:pasted-image)', undefined, { images: [image] });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    expect(store.images.get('opaque-document-id')).toEqual(['pasted-image']);
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: {
        id: 'opaque-document-id',
        title: 'Notes',
        markdown: '# Notes\n\n![sketch.png](markshare-image:pasted-image)',
        imageSources: { 'pasted-image': 'memory://pasted-image' },
      },
    });
    expect(lifecycle.useShareDocument('unknown')).toEqual(unavailable);
  });

  it('does not expose image sources for expired or deleted documents', async () => {
    const expiry = new Date('2026-08-14T18:00:00.000Z');
    let now = new Date('2026-08-13T12:00:00.000Z');
    const ids = ['live-id', 'live-edit', 'gone-id', 'gone-edit'];
    const store = createMemoryDocumentStore();
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now);
    const image = { id: 'secret-image', file: new Blob(['png'], { type: 'image/png' }) };

    await lifecycle.save('# Live\n\n![live](markshare-image:secret-image)', undefined, { images: [image] });
    const expired = await lifecycle.save('# Gone\n\n![gone](markshare-image:secret-image)', undefined, {
      expiresAt: expiry,
      images: [image],
    });
    if (expired.kind !== 'published') throw new Error('Expected save to succeed');

    now = expiry;
    expect(lifecycle.useShareDocument('live-id')).toMatchObject({
      kind: 'available',
      document: { imageSources: { 'secret-image': 'memory://secret-image' } },
    });
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);
    expect(lifecycle.useEditDocument(expired.document.id, 'owner-user')).toEqual(unavailable);
  });

  it('lets the owner grant and revoke another signed-in creator without changing the share link', async () => {
    const store = createMemoryDocumentStore();
    store.creators.set('editor@example.com', 'editor-user');
    const lifecycle = createDocumentLifecycle(store, () => 'opaque-document-id');
    const published = await lifecycle.save('# Release notes', undefined, undefined, 'owner-user');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await expect(lifecycle.grantEditor(published.document, 'editor@example.com')).resolves.toEqual({ kind: 'granted' });
    expect(lifecycle.useEditDocument('opaque-document-id', 'editor-user')).toMatchObject({
      kind: 'available',
      document: { id: 'opaque-document-id', role: 'editor', markdown: '# Release notes' },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toMatchObject({
      kind: 'available',
      document: { id: 'opaque-document-id', markdown: '# Release notes' },
    });

    await expect(lifecycle.revokeEditor(published.document, 'editor-user')).resolves.toEqual({ kind: 'revoked' });
    expect(lifecycle.useEditDocument('opaque-document-id', 'editor-user')).toEqual(unavailable);
    expect(lifecycle.useEditDocument('opaque-document-id', 'owner-user')).toMatchObject({
      kind: 'available',
      document: { role: 'owner' },
    });
  });

  it('returns unknown when the granted email is not a signed-in creator', async () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');
    const published = await lifecycle.save('# Notes', undefined, undefined, 'owner-user');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    await expect(lifecycle.grantEditor(published.document, 'nobody@example.com')).resolves.toEqual({ kind: 'unknown' });
  });

  it('returns the same unavailable outcome for a deleted document opened by its owner', async () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');
    const published = await lifecycle.save('# Secret notes', undefined, undefined, 'owner-user');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await lifecycle.delete(published.document);

    expect(lifecycle.useEditDocument(published.document.id, 'owner-user')).toEqual(unavailable);
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
  });

  it('deletes due image files while keeping an available document and rewrites stored markdown', async () => {
    const uploadedAt = new Date('2026-08-13T12:00:00.000Z');
    const dueAt = imageExpiresAt(uploadedAt);
    let now = uploadedAt;
    const store = createMemoryDocumentStore();
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now);
    const cleanup = createDocumentCleanup(store, () => now);
    const image = { id: 'sketch', file: new Blob(['png'], { type: 'image/png' }) };

    const published = await lifecycle.save('# Notes\n\n![sketch.png](markshare-image:sketch)', undefined, { images: [image] });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    now = new Date(dueAt.getTime() - 1);
    expect(lifecycle.useShareDocument('doc-id')).toMatchObject({
      kind: 'available',
      document: { imageSources: { sketch: 'memory://sketch' } },
    });

    now = dueAt;
    await expect(cleanup()).resolves.toEqual({
      kind: 'cleaned',
      removed: [],
      expiredImages: [{ documentId: 'doc-id', imageCount: 1 }],
    });
    expect(store.images.has('doc-id')).toBe(false);
    expect(store.documents.get('doc-id')?.markdown).toBe('# Notes\n\n*[Removed image: sketch.png]*');
    expect(lifecycle.useShareDocument('doc-id')).toMatchObject({
      kind: 'available',
      document: { markdown: '# Notes\n\n*[Removed image: sketch.png]*' },
    });
    const shareOutcome = lifecycle.useShareDocument('doc-id');
    expect(shareOutcome.kind === 'available' ? shareOutcome.document.imageSources : undefined).toBeUndefined();
  });

  it('backfills image expiry for existing files without a deadline', async () => {
    const now = new Date('2026-08-13T12:00:00.000Z');
    const store = createMemoryDocumentStore();
    const lifecycle = createDocumentLifecycle(store, () => 'doc-id', () => now);
    const cleanup = createDocumentCleanup(store, () => now);
    await lifecycle.save('# Notes\n\n![sketch.png](markshare-image:legacy)');
    store.addImage('doc-id', 'legacy');
    expect(store.imageExpiry.has('legacy')).toBe(false);

    await expect(cleanup()).resolves.toMatchObject({ kind: 'cleaned', removed: [], expiredImages: [] });
    expect(store.imageExpiry.get('legacy')).toEqual(imageExpiresAt(now));
  });

  it('rewrites dead refs on save, deletes unreferenced files, and reclaims image slots', async () => {
    const uploadedAt = new Date('2026-08-13T12:00:00.000Z');
    const dueAt = imageExpiresAt(uploadedAt);
    let now = uploadedAt;
    const store = createMemoryDocumentStore();
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now);
    const cleanup = createDocumentCleanup(store, () => now);
    const first = { id: 'gone', file: new Blob(['png'], { type: 'image/png' }) };
    const second = { id: 'kept', file: new Blob(['png'], { type: 'image/png' }) };

    const published = await lifecycle.save(
      '# Notes\n\n![gone.png](markshare-image:gone)\n\n![kept.png](markshare-image:kept)',
      undefined,
      { images: [first, second] },
    );
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    store.imageExpiry.set('kept', new Date(dueAt.getTime() + 60_000));

    now = dueAt;
    await cleanup();
    expect(store.images.get('doc-id')).toEqual(['kept']);

    const revised = await lifecycle.save('# Notes\n\n![kept.png](markshare-image:kept)', published.document);
    if (revised.kind !== 'published') throw new Error('Expected save to succeed');
    expect(revised.document.markdown).toBe('# Notes\n\n![kept.png](markshare-image:kept)');

    const replacement = { id: 'fresh', file: new Blob(['png'], { type: 'image/png' }) };
    const withNew = await lifecycle.save(
      '# Notes\n\n![kept.png](markshare-image:kept)\n\n![fresh.png](markshare-image:fresh)',
      revised.document,
      { images: [replacement] },
    );
    if (withNew.kind !== 'published') throw new Error('Expected save to succeed');
    expect(store.images.get('doc-id')).toEqual(['kept', 'fresh']);
  });

  it('does not upload pending images that are no longer referenced in the markdown', async () => {
    const store = createMemoryDocumentStore();
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'));
    const image = { id: 'leftover', file: new File(['x'], 'leftover.png', { type: 'image/png' }) };

    await expect(lifecycle.save('# Notes', undefined, { images: [image] })).resolves.toMatchObject({ kind: 'published' });
    expect(store.images.size).toBe(0);
  });

  it('publishes the rewritten document even if leftover image deletion fails', async () => {
    const store = createMemoryDocumentStore();
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle({
      ...store,
      removeImages: async () => {
        throw new Error('delete failed');
      },
    }, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'));
    const image = { id: 'leftover', file: new File(['x'], 'leftover.png', { type: 'image/png' }) };
    const published = await lifecycle.save('# Notes\n\n![leftover](markshare-image:leftover)', undefined, { images: [image] });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await expect(lifecycle.save('# Notes', published.document)).resolves.toMatchObject({
      kind: 'published',
      document: { markdown: '# Notes' },
    });
    expect(store.images.get('doc-id')).toEqual(['leftover']);
  });

  it('keeps unreferenced images when persist fails after a dropped ref', async () => {
    const store = createMemoryDocumentStore();
    let persist: 'ok' | 'fail' = 'ok';
    const persistence: DocumentPersistence = {
      ...store,
      async save(document) {
        if (persist === 'fail') throw new Error('persist failed');
        return store.save(document);
      },
    };
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle(persistence, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'));
    const image = { id: 'kept', file: new File(['x'], 'kept.png', { type: 'image/png' }) };
    const published = await lifecycle.save('# Notes\n\n![kept](markshare-image:kept)', undefined, { images: [image] });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    persist = 'fail';
    await expect(lifecycle.save('# Notes', published.document)).resolves.toEqual({ kind: 'failed' });
    expect(store.images.get('doc-id')).toEqual(['kept']);
    expect(store.documents.get('doc-id')?.markdown).toBe('# Notes\n\n![kept](markshare-image:kept)');
  });

  it('rewrites the current stored markdown rather than a stale list snapshot', async () => {
    const uploadedAt = new Date('2026-08-13T12:00:00.000Z');
    const dueAt = imageExpiresAt(uploadedAt);
    let now = uploadedAt;
    const store = createMemoryDocumentStore();
    const listDocuments = store.listDocuments.bind(store);
    store.listDocuments = async () => {
      const listed = await listDocuments();
      const document = store.documents.get('doc-id');
      if (document) {
        store.documents.set('doc-id', {
          ...document,
          markdown: '# Edited later\n\n![sketch.png](markshare-image:sketch)',
        });
      }
      return listed;
    };
    const ids = ['doc-id', 'edit-id'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now);
    const cleanup = createDocumentCleanup(store, () => now);
    const image = { id: 'sketch', file: new Blob(['png'], { type: 'image/png' }) };
    const published = await lifecycle.save('# Notes\n\n![sketch.png](markshare-image:sketch)', undefined, { images: [image] });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    now = dueAt;
    await expect(cleanup()).resolves.toMatchObject({ kind: 'cleaned' });
    expect(store.documents.get('doc-id')?.markdown).toBe('# Edited later\n\n*[Removed image: sketch.png]*');
  });
});
