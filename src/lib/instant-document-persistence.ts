import { lookup } from '@instantdb/react';
import { documentImagePath, documentImagePrefix, imageIdFromPath } from '../document-image';
import { createDocumentLifecycle, createLocalStorageAbuseStore, type DocumentPersistence, type PersistedImage, type PersistedShareOutcome } from '../document-lifecycle';
import { createDocumentId, db } from './instant';

type InstantFile = { id: string; path?: string | null; url?: string | null };

function imagesFor(documentId: string, files: InstantFile[] | undefined): PersistedImage[] {
  return (files ?? []).flatMap((file) => {
    const id = imageIdFromPath(documentId, file.path ?? '');
    return id && file.url ? [{ id, url: file.url }] : [];
  });
}

const instantDocumentPersistence: DocumentPersistence = {
  async save(document) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[document.id].ruleParams({ knownDocumentId: document.id, editId: document.editId }).update({
      title: document.title,
      markdown: document.markdown,
      editId: document.editId,
      updatedAt: document.updatedAt,
      ...(document.createdAt ? { createdAt: document.createdAt } : {}),
      ...('expiresAt' in document ? { expiresAt: document.expiresAt } : {}),
    }));
    return 'published';
  },

  async uploadImages(documentId, images, editId) {
    if (!db) return 'not-configured';
    const uploaded: string[] = [];
    try {
      for (const image of images) {
        await db.storage.uploadFile(documentImagePath(documentId, image.id), image.file, {
          contentDisposition: 'inline',
          contentType: image.file.type || 'application/octet-stream',
        });
        uploaded.push(image.id);
      }
      return 'uploaded';
    } catch (error) {
      try {
        await instantDocumentPersistence.removeImages(documentId, uploaded, editId);
      } catch {
        // Compensation is best-effort; document cleanup still removes leftovers.
      }
      throw error;
    }
  },

  async removeImages(documentId, imageIds, editId) {
    const database = db;
    if (!database || !imageIds.length) return;
    await database.transact(imageIds.map((imageId) => (
      database.tx.$files[lookup('path', documentImagePath(documentId, imageId))]
        .ruleParams({ knownDocumentId: documentId, editId })
        .delete()
    )));
  },

  async listImageIds(documentId) {
    if (!db) return [];
    const { data } = await db.queryOnce(
      { $files: { $: { where: { path: { $like: `${documentImagePrefix(documentId)}%` } } } } },
      { ruleParams: { knownDocumentId: documentId } },
    );
    return imagesFor(documentId, data.$files).map((image) => image.id);
  },

  useShareDocument(id): PersistedShareOutcome {
    if (!db) return { kind: 'unavailable' };

    const { data, error, isLoading } = db.useQuery(
      {
        documents: { $: { where: { id } } },
        $files: { $: { where: { path: { $like: `${documentImagePrefix(id)}%` } } } },
      },
      { ruleParams: { knownDocumentId: id } },
    );

    if (isLoading) return { kind: 'loading' };
    const document = data?.documents[0];
    return error || !document
      ? { kind: 'unavailable' }
      : { kind: 'available', document: { ...document, images: imagesFor(id, data.$files) } };
  },

  useEditDocument(editId): PersistedShareOutcome {
    if (!db) return { kind: 'unavailable' };

    const documentQuery = db.useQuery(
      { documents: { $: { where: { editId: editId || '__none__' } } } },
      { ruleParams: { editId: editId || '__none__' } },
    );
    const document = documentQuery.data?.documents[0];
    const filesQuery = db.useQuery(
      document?.id
        ? { $files: { $: { where: { path: { $like: `${documentImagePrefix(document.id)}%` } } } } }
        : null,
      { ruleParams: { knownDocumentId: document?.id } },
    );

    if (!editId) return { kind: 'unavailable' };
    if (documentQuery.isLoading || (document && filesQuery.isLoading)) return { kind: 'loading' };
    return documentQuery.error || !document
      ? { kind: 'unavailable' }
      : { kind: 'available', document: { ...document, images: imagesFor(document.id, filesQuery.data?.$files) } };
  },

  async markDeleted(id, editId, deletedAt) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[id].ruleParams({ knownDocumentId: id, editId }).update({
      deletedAt,
      updatedAt: deletedAt,
    }));
    return 'deleted';
  },

  async rotateEditId(id, editId, nextEditId) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[id].ruleParams({ knownDocumentId: id, editId }).update({
      editId: nextEditId,
    }));
    return 'rotated';
  },
};

export const documentLifecycle = createDocumentLifecycle(
  instantDocumentPersistence,
  createDocumentId,
  () => new Date(),
  undefined,
  undefined,
  typeof localStorage === 'undefined' ? undefined : createLocalStorageAbuseStore(localStorage),
);
