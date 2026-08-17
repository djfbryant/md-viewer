import { init } from '@instantdb/admin';
import { documentImagePrefix } from '../src/document-image';
import type { DocumentRemovalStore, RemovableDocument } from '../src/document-lifecycle';
import { toDate, type InstantDate } from '../src/instant-date';

type InstantFile = { id: string };
type InstantDocument = {
  id: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

export function createInstantRemovalStore(
  appId = process.env.INSTANT_APP_ID ?? process.env.VITE_INSTANT_APP_ID,
  adminToken = process.env.INSTANT_APP_ADMIN_TOKEN,
): DocumentRemovalStore | null {
  if (!appId || !adminToken) return null;

  const db = init({ appId, adminToken });

  // `$files.id` is an Instant storage id, not the image id the editor handed out.
  // It never leaves this adapter.
  const ownedFileIds = async (documentId: string) => {
    const data = await db.query({
      $files: { $: { where: { path: { $like: `${documentImagePrefix(documentId)}%` } } } },
    }) as { $files?: InstantFile[] };
    return (data.$files ?? []).map((file) => file.id);
  };

  return {
    async listDocuments(): Promise<RemovableDocument[]> {
      const data = await db.query({ documents: {} }) as { documents?: InstantDocument[] };
      return (data.documents ?? []).map((document) => ({
        id: document.id,
        expiresAt: toDate(document.expiresAt),
        deletedAt: toDate(document.deletedAt),
      }));
    },
    async removeDocumentAndImages(id) {
      const fileIds = await ownedFileIds(id);
      await db.transact([
        ...fileIds.map((fileId) => db.tx.$files[fileId].delete()),
        db.tx.documents[id].delete(),
      ]);
      return fileIds.length;
    },
  };
}
