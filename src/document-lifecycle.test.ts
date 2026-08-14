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
  addImage(documentId: string, imageId: string): void;
} {
  const documents = new Map<string, StoredMemoryDocument>();
  const images = new Map<string, string[]>();
  return {
    documents,
    images,
    addImage(documentId, imageId) {
      images.set(documentId, [...(images.get(documentId) ?? []), imageId]);
    },
    async save(document) {
      documents.set(document.id, { ...documents.get(document.id), ...document });
      return 'published';
    },
    useShareDocument(id) {
      const document = documents.get(id);
      return document ? { kind: 'available', document } : { kind: 'unavailable' };
    },
    async markDeleted(id, editId, deletedAt) {
      const document = documents.get(id);
      if (!document || document.editId !== editId) throw new Error('not allowed');
      documents.set(id, { ...document, deletedAt });
      return 'deleted';
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
      useShareDocument: () => unavailable,
      markDeleted: vi.fn(),
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.save('Text')).resolves.toEqual({ kind: 'failed' });
  });

  it('keeps a missing database configuration distinct from a failed publish', async () => {
    const lifecycle = createDocumentLifecycle({
      save: async () => 'not-configured',
      useShareDocument: () => unavailable,
      markDeleted: async () => 'not-configured',
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
});
