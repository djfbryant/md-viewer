import type {
  DocumentPersistence,
  DocumentRemovalStore,
  PersistedDocument,
  RemovableDocument,
  StoredDocument,
} from '../document-lifecycle';

export type MemoryDocumentStore = DocumentPersistence & DocumentRemovalStore & {
  documents: Map<string, StoredDocument>;
  images: Map<string, string[]>;
  imageUrls: Map<string, string>;
  imageExpiry: Map<string, Date>;
  /** While true every read answers `loading`, the way a live query does before it settles. */
  pending: boolean;
  addDocument(document: StoredDocument): void;
  addImage(documentId: string, imageId: string, url?: string, expiresAt?: Date): void;
};

/**
 * The test adapter behind both seams. Production splits them across two Instant SDKs;
 * in memory one store can honour both, so tests exercise the real lifecycle rules
 * rather than a stand-in for them.
 */
export function createMemoryDocumentStore(
  imageUrl: (imageId: string) => string = (imageId) => `memory://${imageId}`,
): MemoryDocumentStore {
  const documents = new Map<string, StoredDocument>();
  const images = new Map<string, string[]>();
  const imageUrls = new Map<string, string>();
  const imageExpiry = new Map<string, Date>();
  const state = { pending: false };

  const imagesOf = (documentId: string) => (images.get(documentId) ?? []).map((id) => ({
    id,
    expiresAt: imageExpiry.get(id) ?? null,
  }));

  const forget = (imageIds: string[]) => {
    for (const id of imageIds) {
      imageUrls.delete(id);
      imageExpiry.delete(id);
    }
  };

  const read = (document: StoredDocument | undefined) => {
    if (state.pending) return { kind: 'loading' as const };
    if (!document) return { kind: 'unavailable' as const };
    const persisted: PersistedDocument = {
      id: document.id,
      title: document.title,
      markdown: document.markdown,
      expiresAt: document.expiresAt ?? null,
      deletedAt: document.deletedAt ?? null,
      images: (images.get(document.id) ?? []).map((id) => ({
        id,
        url: imageUrls.get(id) ?? imageUrl(id),
        expiresAt: imageExpiry.get(id) ?? null,
      })),
    };
    return { kind: 'available' as const, document: persisted };
  };

  return {
    documents,
    images,
    imageUrls,
    imageExpiry,
    get pending() { return state.pending; },
    set pending(value: boolean) { state.pending = value; },
    addDocument(document) {
      documents.set(document.id, document);
    },
    addImage(documentId, imageId, url, expiresAt) {
      images.set(documentId, [...(images.get(documentId) ?? []), imageId]);
      imageUrls.set(imageId, url ?? imageUrl(imageId));
      if (expiresAt) imageExpiry.set(imageId, expiresAt);
    },
    async save(document) {
      documents.set(document.id, { ...documents.get(document.id), ...document });
      return 'published';
    },
    async uploadImage(documentId, image, _editId, expiresAt) {
      images.set(documentId, [...(images.get(documentId) ?? []), image.id]);
      imageUrls.set(image.id, imageUrl(image.id));
      imageExpiry.set(image.id, expiresAt);
      return 'uploaded';
    },
    async removeImages(documentId, imageIds) {
      const remaining = (images.get(documentId) ?? []).filter((id) => !imageIds.includes(id));
      if (remaining.length) images.set(documentId, remaining);
      else images.delete(documentId);
      forget(imageIds);
    },
    async listImages(documentId) {
      return imagesOf(documentId);
    },
    useShareDocument(id) {
      return read(documents.get(id));
    },
    useEditDocument(editId) {
      return read([...documents.values()].find((candidate) => candidate.editId === editId));
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
        images: imagesOf(document.id),
        async remove() {
          const owned = images.get(document.id) ?? [];
          documents.delete(document.id);
          images.delete(document.id);
          forget(owned);
          return owned.length;
        },
        async removeImages(imageIds, rewriteMarkdown) {
          const remaining = (images.get(document.id) ?? []).filter((id) => !imageIds.includes(id));
          if (remaining.length) images.set(document.id, remaining);
          else images.delete(document.id);
          forget(imageIds);
          // Read the markdown held now, not the copy listed at the start of the run.
          const stored = documents.get(document.id);
          if (stored) documents.set(document.id, { ...stored, markdown: rewriteMarkdown(stored.markdown) });
        },
        async setImageExpiry(imageId, expiresAt) {
          imageExpiry.set(imageId, expiresAt);
        },
      }));
    },
  };
}
