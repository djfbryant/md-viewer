import { init } from '@instantdb/admin';
import type { DocumentRemovalStore, InstantDate, RemovableDocument } from '../src/document-lifecycle';

const IMAGE_PATH_PREFIX = 'documents/';

type InstantFile = { id: string; path?: string | null };
type InstantDocument = {
  id: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

function ownedImageIds(documentId: string, files: InstantFile[]) {
  const prefix = `${IMAGE_PATH_PREFIX}${documentId}/`;
  return files.filter((file) => file.path?.startsWith(prefix)).map((file) => file.id);
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
        expiresAt: document.expiresAt,
        deletedAt: document.deletedAt,
        imageIds: ownedImageIds(document.id, files),
      }));
    },
    async removeDocumentAndImages(id, imageIds) {
      await db.transact([
        ...imageIds.map((imageId) => db.tx.$files[imageId].delete()),
        db.tx.documents[id].delete(),
      ]);
    },
  };
}
