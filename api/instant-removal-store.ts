import { init } from '@instantdb/admin';
import { documentImagePrefix, imageIdFromPath } from '../src/document-image';
import type { DocumentRemovalStore, InstantDate, RemovableDocument } from '../src/document-lifecycle';

type InstantFile = { id: string; path?: string | null; expiresAt?: InstantDate | null };
type InstantDocument = {
  id: string;
  markdown: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

function ownedImages(documentId: string, files: InstantFile[]) {
  const prefix = documentImagePrefix(documentId);
  return files.flatMap((file) => {
    const imageId = imageIdFromPath(documentId, file.path ?? '');
    return imageId && file.path?.startsWith(prefix) ? [{ id: imageId, expiresAt: file.expiresAt }] : [];
  });
}

export function createInstantRemovalStore(
  appId = process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID,
  adminToken = process.env.INSTANT_APP_ADMIN_TOKEN,
): DocumentRemovalStore | null {
  if (!appId || !adminToken) return null;

  const db = init({ appId, adminToken });

  return {
    async listDocuments(): Promise<RemovableDocument[]> {
      const data = await db.query({ documents: {}, $files: {} }) as {
        documents?: InstantDocument[];
        $files?: InstantFile[];
      };
      const files = data.$files ?? [];
      return (data.documents ?? []).map((document) => ({
        id: document.id,
        markdown: document.markdown,
        expiresAt: document.expiresAt,
        deletedAt: document.deletedAt,
        images: ownedImages(document.id, files),
      }));
    },
    async removeDocumentAndImages(id, imageIds) {
      await db.transact([
        ...imageIds.map((imageId) => db.tx.$files[imageId].delete()),
        db.tx.documents[id].delete(),
      ]);
    },
    async removeImagesAndUpdateMarkdown(id, imageIds, markdown) {
      await db.transact([
        ...imageIds.map((imageId) => db.tx.$files[imageId].delete()),
        db.tx.documents[id].update({ markdown }),
      ]);
    },
    async backfillImageExpiry(imageId, expiresAt) {
      await db.transact(db.tx.$files[imageId].update({ expiresAt }));
    },
  };
}
