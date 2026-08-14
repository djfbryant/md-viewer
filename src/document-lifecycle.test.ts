import { describe, expect, it, vi } from 'vitest';
import {
  createDocumentLifecycle,
  type DocumentPersistence,
  type DocumentRemovalStore,
  type PersistedDocument,
  type RemovableDocument,
} from './document-lifecycle';

type StoredMemoryDocument = PersistedDocument & {
  editId: string;
  createdAt?: Date;
  updatedAt: Date;
};

function memoryStore(): DocumentPersistence & DocumentRemovalStore & {
  documents: Map<string, StoredMemoryDocument>;
  images: Map<string, string[]>;
  imageUrls: Map<string, string>;
  addImage(documentId: string, imageId: string, url?: string): void;
} {
  const documents = new Map<string, StoredMemoryDocument>();
  const images = new Map<string, string[]>();
  const imageUrls = new Map<string, string>();
  const withImages = (document: StoredMemoryDocument) => ({
    ...document,
    images: (images.get(document.id) ?? []).map((id) => ({ id, url: imageUrls.get(id) ?? `memory://${id}` })),
  });
  return {
    documents,
    images,
    imageUrls,
    addImage(documentId, imageId, url) {
      images.set(documentId, [...(images.get(documentId) ?? []), imageId]);
      imageUrls.set(imageId, url ?? `memory://${imageId}`);
    },
    async save(document) {
      documents.set(document.id, { ...documents.get(document.id), ...document });
      return 'published';
    },
    async uploadImages(documentId, uploaded) {
      for (const image of uploaded) {
        images.set(documentId, [...(images.get(documentId) ?? []), image.id]);
        imageUrls.set(image.id, `memory://${image.id}`);
      }
      return 'uploaded';
    },
    async removeImages(documentId, imageIds) {
      const remaining = (images.get(documentId) ?? []).filter((id) => !imageIds.includes(id));
      if (remaining.length) images.set(documentId, remaining);
      else images.delete(documentId);
      for (const id of imageIds) imageUrls.delete(id);
    },
    async listImageIds(documentId) {
      return images.get(documentId) ?? [];
    },
    useShareDocument(id) {
      const document = documents.get(id);
      return document ? { kind: 'available', document: withImages(document) } : { kind: 'unavailable' };
    },
    useEditDocument(editId) {
      const document = [...documents.values()].find((candidate) => candidate.editId === editId);
      return document ? { kind: 'available', document: withImages(document) } : { kind: 'unavailable' };
    },
    async markDeleted(id, editId, deletedAt) {
      const document = documents.get(id);
      if (!document || document.editId !== editId) throw new Error('not allowed');
      documents.set(id, { ...document, deletedAt });
      return 'deleted';
    },
    async rotateEditId(id, editId, nextEditId) {
      const document = documents.get(id);
      if (!document || document.editId !== editId) throw new Error('not allowed');
      documents.set(id, { ...document, editId: nextEditId });
      return 'rotated';
    },
    async listDocuments(): Promise<RemovableDocument[]> {
      return [...documents.values()].map((document) => ({
        id: document.id,
        expiresAt: document.expiresAt,
        deletedAt: document.deletedAt,
        imageIds: images.get(document.id) ?? [],
      }));
    },
    async removeDocumentAndImages(id) {
      documents.delete(id);
      images.delete(id);
    },
  };
}

const unavailable = { kind: 'unavailable' as const };

describe('Document lifecycle', () => {
  it('publishes a titled document that a holder of its share ID can read', async () => {
    const persistence = memoryStore();
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'opaque-document-id');
    expect(lifecycle.useShareDocument('unknown')).toEqual(unavailable);
  });

  it('translates a persistence failure to a generic publish failure', async () => {
    const persistence: DocumentPersistence = {
      save: vi.fn().mockRejectedValue(new Error('network error')),
      uploadImages: vi.fn(),
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
      uploadImages: async () => 'not-configured',
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
    const persistence = memoryStore();
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'opaque-document-id', () => now);
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'opaque-document-id', () => now);

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
    const store = memoryStore();
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => ids.shift()!, () => now);

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
    const store = memoryStore();
    const ids = ['keep-id', 'keep-edit', 'drop-id', 'drop-edit'];
    const lifecycle = createDocumentLifecycle(store, () => ids.shift()!, () => now, store);

    const kept = await lifecycle.save('# Keep');
    const expired = await lifecycle.save('# Drop', undefined, { expiresAt: expiry });
    if (kept.kind !== 'published' || expired.kind !== 'published') throw new Error('Expected saves to succeed');
    store.addImage(kept.document.id, 'keep-image');
    store.addImage(expired.document.id, 'drop-image-1');
    store.addImage(expired.document.id, 'drop-image-2');

    now = expiry;
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);

    await expect(lifecycle.cleanup()).resolves.toEqual({
      kind: 'cleaned',
      removed: [{ documentId: expired.document.id, imageCount: 2 }],
    });
    expect(lifecycle.useShareDocument(kept.document.id)).toMatchObject({ kind: 'available', document: { id: kept.document.id } });
    expect(lifecycle.useShareDocument(expired.document.id)).toEqual(unavailable);
    expect(store.images.get(kept.document.id)).toEqual(['keep-image']);
    expect(store.images.has(expired.document.id)).toBe(false);
    expect(store.documents.has(expired.document.id)).toBe(false);
  });

  it('makes a deleted document unavailable immediately and cleanup removes it with its images', async () => {
    const store = memoryStore();
    const lifecycle = createDocumentLifecycle(store, () => 'opaque-document-id', () => new Date('2026-08-13T12:00:00Z'), store);
    const published = await lifecycle.save('# Remove me');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');
    store.addImage(published.document.id, 'pasted-image');

    await expect(lifecycle.delete(published.document)).resolves.toEqual({ kind: 'deleted' });
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
    expect(store.documents.has(published.document.id)).toBe(true);
    expect(store.images.get(published.document.id)).toEqual(['pasted-image']);

    await expect(lifecycle.cleanup()).resolves.toEqual({
      kind: 'cleaned',
      removed: [{ documentId: published.document.id, imageCount: 1 }],
    });
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
    expect(store.documents.has(published.document.id)).toBe(false);
    expect(store.images.has(published.document.id)).toBe(false);
  });

  it('lets an edit capability open the saved document without exposing that capability on the share outcome', async () => {
    const ids = ['opaque-document-id', 'private-edit-capability'];
    const lifecycle = createDocumentLifecycle(memoryStore(), () => ids.shift()!);
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'pasted-image');

    expect(lifecycle.attachImage({ name: 'sketch.png', type: 'image/png', size: 12 }, 0)).toEqual({
      kind: 'attached',
      image: { id: 'pasted-image', markdown: '![sketch.png](markshare-image:pasted-image)' },
    });
  });

  it('rejects unsupported types, oversized files, and a twenty-first image', () => {
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'image-id');

    expect(lifecycle.attachImage({ name: 'notes.pdf', type: 'application/pdf', size: 12 }, 0)).toEqual({ kind: 'unsupported' });
    expect(lifecycle.attachImage({ name: 'huge.png', type: 'image/png', size: 5 * 1024 * 1024 + 1 }, 0)).toEqual({ kind: 'too-large' });
    expect(lifecycle.attachImage({ name: 'ok.png', type: 'image/png', size: 12 }, 20)).toEqual({ kind: 'too-many' });
    expect(lifecycle.attachImage({ name: 'ok.webp', type: 'image/webp', size: 5 * 1024 * 1024 }, 19)).toMatchObject({ kind: 'attached' });
  });

  it('rejects publishing an image that exceeds the lifecycle limits', async () => {
    const lifecycle = createDocumentLifecycle(memoryStore(), () => 'opaque-document-id');

    await expect(lifecycle.save('# Notes', undefined, {
      images: [{ id: 'huge', file: new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.png', { type: 'image/png' }) }],
    })).resolves.toEqual({ kind: 'failed' });
    await expect(lifecycle.save('# Notes', undefined, {
      images: [{ id: 'pdf', file: new File(['x'], 'notes.pdf', { type: 'application/pdf' }) }],
    })).resolves.toEqual({ kind: 'failed' });
  });

  it('rejects a twenty-first image at save, including additions to an existing document', async () => {
    const png = (id: string) => ({ id, file: new File(['x'], `${id}.png`, { type: 'image/png' }) });
    const store = memoryStore();
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
    const store = memoryStore();
    const persistence: DocumentPersistence = {
      ...store,
      uploadImages: async () => {
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
    const store = memoryStore();
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
    const store = memoryStore();
    let uploads = 0;
    const persistence: DocumentPersistence = {
      ...store,
      uploadImages: async (documentId, uploaded, editId) => {
        uploads += 1;
        if (uploads === 2) throw new Error('upload failed');
        return store.uploadImages(documentId, uploaded, editId);
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
    const store = memoryStore();
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
    const store = memoryStore();
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => ids.shift()!);
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
    const lifecycle = createDocumentLifecycle(memoryStore(), () => ids.shift()!);
    const published = await lifecycle.save('# Secret notes');
    if (published.kind !== 'published') throw new Error('Expected save to succeed');

    await lifecycle.delete(published.document);

    expect(lifecycle.useEditDocument(published.document.editId)).toEqual(unavailable);
    expect(lifecycle.useShareDocument(published.document.id)).toEqual(unavailable);
  });
});
