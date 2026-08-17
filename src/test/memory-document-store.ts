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
  /** While true every read answers `loading`, the way a live query does before it settles. */
  pending: boolean;
  addDocument(document: StoredDocument): void;
  addImage(documentId: string, imageId: string, url?: string): void;
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
  const state = { pending: false };

  const read = (document: StoredDocument | undefined) => {
    if (state.pending) return { kind: 'loading' as const };
    if (!document) return { kind: 'unavailable' as const };
    const persisted: PersistedDocument = {
      id: document.id,
      title: document.title,
      markdown: document.markdown,
      expiresAt: document.expiresAt ?? null,
      deletedAt: document.deletedAt ?? null,
      images: (images.get(document.id) ?? []).map((id) => ({ id, url: imageUrls.get(id) ?? imageUrl(id) })),
    };
    return { kind: 'available' as const, document: persisted };
  };

  return {
    documents,
    images,
    imageUrls,
    get pending() { return state.pending; },
    set pending(value: boolean) { state.pending = value; },
    addDocument(document) {
      documents.set(document.id, document);
    },
    addImage(documentId, imageId, url) {
      images.set(documentId, [...(images.get(documentId) ?? []), imageId]);
      imageUrls.set(imageId, url ?? imageUrl(imageId));
    },
    async save(document) {
      documents.set(document.id, { ...documents.get(document.id), ...document });
      return 'published';
    },
    async uploadImage(documentId, image) {
      images.set(documentId, [...(images.get(documentId) ?? []), image.id]);
      imageUrls.set(image.id, imageUrl(image.id));
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
      }));
    },
    async removeDocumentAndImages(id) {
      const imageCount = (images.get(id) ?? []).length;
      documents.delete(id);
      images.delete(id);
      return imageCount;
    },
  };
}
