import type {
  ClubCreator,
  CreatorLibrary,
  DocumentPersistence,
  DocumentRemovalStore,
  PersistedDocument,
  RemovableDocument,
  StoredDocument,
} from '../document-lifecycle';

export type MemoryDocumentStore = DocumentPersistence & DocumentRemovalStore & {
  documents: Map<string, StoredDocument & { editorUserIds?: string[] }>;
  images: Map<string, string[]>;
  imageUrls: Map<string, string>;
  imageExpiry: Map<string, Date>;
  creators: Map<string, string>;
  /** While true every read answers `loading`, the way a live query does before it settles. */
  pending: boolean;
  addDocument(document: StoredDocument & { editorUserIds?: string[] }): void;
  addImage(documentId: string, imageId: string, url?: string, expiresAt?: Date): void;
};

type StoredMemoryDocument = StoredDocument & { editorUserIds?: string[] };

/**
 * The test adapter behind both seams. Production splits them across two Instant SDKs;
 * in memory one store can honour both, so tests exercise the real lifecycle rules
 * rather than a stand-in for them.
 */
export function createMemoryDocumentStore(
  imageUrl: (imageId: string) => string = (imageId) => `memory://${imageId}`,
): MemoryDocumentStore {
  const documents = new Map<string, StoredMemoryDocument>();
  const images = new Map<string, string[]>();
  const imageUrls = new Map<string, string>();
  const imageExpiry = new Map<string, Date>();
  const creators = new Map<string, string>();
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

  const roleFor = (document: StoredMemoryDocument, userId: string) => {
    if (document.ownerUserId === userId) return 'owner' as const;
    if ((document.editorUserIds ?? []).includes(userId)) return 'editor' as const;
    return undefined;
  };

  const editorsOf = (document: StoredMemoryDocument): ClubCreator[] => (
    (document.editorUserIds ?? []).flatMap((editorUserId) => {
      const email = [...creators.entries()].find(([, storedId]) => storedId === editorUserId)?.[0];
      return email ? [{ userId: editorUserId, email }] : [];
    })
  );

  const read = (document: StoredMemoryDocument | undefined, userId?: string | null) => {
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
    if (userId) {
      const role = roleFor(document, userId);
      if (!role) return { kind: 'unavailable' as const };
      persisted.role = role;
      persisted.editors = editorsOf(document);
    }
    return { kind: 'available' as const, document: persisted };
  };

  const library = (userId: string | null): CreatorLibrary => {
    if (!userId) return { loading: false, owned: [], granted: [] };
    // Availability travels with each entry; the lifecycle owns when entries leave the list.
    const items = [...documents.values()].map((document) => ({
      id: document.id,
      title: document.title,
      expiresAt: document.expiresAt ?? null,
      deletedAt: document.deletedAt ?? null,
    }));
    return {
      loading: false,
      owned: items.filter((document) => documents.get(document.id)?.ownerUserId === userId),
      granted: items.filter((document) => (documents.get(document.id)?.editorUserIds ?? []).includes(userId)),
    };
  };

  return {
    documents,
    images,
    imageUrls,
    imageExpiry,
    creators,
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
    async uploadImage(documentId, image, expiresAt) {
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
    useEditDocument(id, userId) {
      return read(documents.get(id), userId);
    },
    useCreatorLibrary: library,
    useClubCreators() {
      return [...creators.entries()].map(([email, userId]) => ({ userId, email }));
    },
    async markDeleted(id, deletedAt) {
      const document = documents.get(id);
      if (!document) throw new Error('not allowed');
      documents.set(id, { ...document, deletedAt });
      return 'deleted';
    },
    async grantEditor(id, editorUserId) {
      const document = documents.get(id);
      if (!document) return 'forbidden';
      documents.set(id, { ...document, editorUserIds: [...new Set([...(document.editorUserIds ?? []), editorUserId])] });
      return 'granted';
    },
    async revokeEditor(id, editorUserId) {
      const document = documents.get(id);
      if (!document) return 'forbidden';
      documents.set(id, { ...document, editorUserIds: (document.editorUserIds ?? []).filter((candidate) => candidate !== editorUserId) });
      return 'revoked';
    },
    async findCreatorUserId(email) {
      return creators.get(email) ?? null;
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
