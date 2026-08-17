import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentCleanup,
  createDocumentLifecycle,
  createLocalStorageAbuseStore,
  createMemoryAbuseStore,
  type DocumentPersistence,
} from './document-lifecycle';
import { createMemoryDocumentStore } from './test/memory-document-store';

const unavailable = { kind: 'unavailable' as const };

describe('Document lifecycle', () => {
  it('publishes a titled document that a holder of its share ID can read', async () => {
    const persistence = createMemoryDocumentStore();
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(persistence, () => ids.shift()!, () => new Date('2026-08-13T12:00:00Z'));

    const published = await lifecycle.save('# Release notes\n\nHello **reader**.');

    expect(published).toEqual({
      kind: 'published',
      document: { id: 'opaque-document-id', editId: 'private-edit-capability', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
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
    await expect(revision.save('# Keep', published.document, { images: [png('one'), png('two')] })).resolves.toMatchObject({ kind: 'published' });
    await expect(revision.save('# Keep', published.document, { images: [png('three')] })).resolves.toEqual({ kind: 'rate-limited', limit: 'upload' });
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
    Object.defineProperty(oversized.file, 'size', { value: 5 * 1024 * 1024 + 1 });
    await expect(uploads.save('# Huge', undefined, { images: [oversized] })).resolves.toEqual({ kind: 'failed' });
    await expect(uploads.save('# Ok', undefined, {
      images: [{ id: 'ok', file: new File(['x'], 'ok.png', { type: 'image/png' }) }],
    })).resolves.toMatchObject({ kind: 'published' });
  });

  it('translates a persistence failure to a generic publish failure', async () => {
    const persistence: DocumentPersistence = {
      save: vi.fn().mockRejectedValue(new Error('network error')),
      uploadImage: vi.fn(),
      removeImages: vi.fn(),
      listImageIds: vi.fn().mockResolvedValue([]),
      useShareDocument: () => unavailable,
      useEditDocument: () => unavailable,
      markDeleted: vi.fn(),
      rotateEditId: vi.fn(),
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('Text')).resolves.toEqual({ kind: 'failed' });
  });

  it('keeps a missing database configuration distinct from a failed publish', async () => {
    const lifecycle = createDocumentLifecycle({
      save: async () => 'not-configured',
      uploadImage: async () => 'not-configured',
      removeImages: async () => undefined,
      listImageIds: async () => [],
      useShareDocument: () => unavailable,
      useEditDocument: () => unavailable,
      markDeleted: async () => 'not-configured',
      rotateEditId: async () => 'not-configured',
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
    });
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
    expect(store.documents.has(published.document.id)).toBe(false);
    expect(store.images.has(published.document.id)).toBe(false);
  });

  it('lets an edit capability open the saved document without exposing that capability on the share outcome', async () => {
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => ids.shift()!);
    await lifecycle.save('# Release notes\n\nHello **reader**.');

    expect(lifecycle.useEditDocument('private-edit-capability')).toEqual({
      kind: 'available',
      document: {
        id: 'opaque-document-id',
        editId: 'private-edit-capability',
        title: 'Release notes',
        markdown: '# Release notes\n\nHello **reader**.',
      },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
    expect(lifecycle.useEditDocument('wrong-edit-capability')).toEqual(unavailable);
    expect(lifecycle.useEditDocument('')).toEqual(unavailable);
  });

  it('attaches a supported image as a document-scoped markdown reference', () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'pasted-image');

    expect(lifecycle.attachImage({ name: 'sketch.png', type: 'image/png', size: 12 }, 0)).toEqual({
      kind: 'attached',
      image: { id: 'pasted-image', markdown: '![sketch.png](markshare-image:pasted-image)' },
    });
  });

  it('rejects unsupported types, oversized files, and a twenty-first image', () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'image-id');

    expect(lifecycle.attachImage({ name: 'notes.pdf', type: 'application/pdf', size: 12 }, 0)).toEqual({ kind: 'unsupported' });
    expect(lifecycle.attachImage({ name: 'huge.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }, 0)).toEqual({ kind: 'too-large' });
    expect(lifecycle.attachImage({ name: 'ok.png', type: 'image/png', size: 12 }, 20)).toEqual({ kind: 'too-many' });
    expect(lifecycle.attachImage({ name: 'ok.webp', type: 'image/webp', size: 5 * 1024 * 1024 }, 19)).toMatchObject({ kind: 'attached' });
  });

  it('rejects publishing an image that exceeds the lifecycle limits', async () => {
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes', undefined, {
      images: [{ id: 'huge', file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }) }],
    })).resolves.toEqual({ kind: 'failed' });
    await expect(lifecycle.save('# Notes', undefined, {
      images: [{ id: 'pdf', file: new File(['x'], 'notes.pdf', { type: 'application/pdf' }) }],
    })).resolves.toEqual({ kind: 'failed' });
  });

  it('rejects a twenty-first image at save, including additions to an existing document', async () => {
    const png = (id: string) => ({ id, file: new File(['x'], `${id}.png`, { type: 'image/png' }) });
    const store = createMemoryDocumentStore();
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!);

    await expect(lifecycle.save('# Notes', undefined, {
      images: Array.from({ length: 21 }, (_, index) => png(`batch-${index}`)),
    })).resolves.toEqual({ kind: 'failed' });
    expect(store.images.size).toBe(0);

    const published = await lifecycle.save('# Notes', undefined, {
      images: Array.from({ length: 20 }, (_, index) => png(`kept-${index}`)),
    });
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    await expect(lifecycle.save('# Notes', published.document, { images: [png('extra')] })).resolves.toEqual({ kind: 'failed' });
    expect(store.images.get(published.document.id)).toHaveLength(20);
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

    await expect(lifecycle.save('# Notes', undefined, {
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
      uploadImage: async (documentId, image) => {
        uploads += 1;
        if (uploads === 2) throw new Error('upload failed');
        return store.uploadImage(documentId, image);
      },
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes', undefined, {
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
    expect(lifecycle.useEditDocument(expired.document.editId)).toEqual(unavailable);
  });

  it('replaces a leaked edit capability while the share link continues to serve the saved document', async () => {
    const ids = ['opaque-document-id', 'private-edit-capability', 'replacement-edit-capability'];
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => ids.shift()!);
    const published = await lifecycle.save('# Release notes');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await expect(lifecycle.rotate(published.document)).resolves.toEqual({
      kind: 'rotated',
      document: { id: 'opaque-document-id', editId: 'replacement-edit-capability' },
    });

    expect(lifecycle.useEditDocument('private-edit-capability')).toEqual(unavailable);
    expect(lifecycle.useEditDocument('replacement-edit-capability')).toMatchObject({
      kind: 'available',
      document: { id: 'opaque-document-id', editId: 'replacement-edit-capability', markdown: '# Release notes' },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toMatchObject({
      kind: 'available',
      document: { id: 'opaque-document-id', markdown: '# Release notes' },
    });
  });

  it('returns the same unavailable outcome for a deleted document opened through its edit capability', async () => {
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(createMemoryDocumentStore(), () => ids.shift()!);
    const published = await lifecycle.save('# Secret notes');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await lifecycle.delete(published.document);

    expect(lifecycle.useEditDocument(published.document.editId)).toEqual(unavailable);
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
  });
});
