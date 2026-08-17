import { init } from '@instantdb/admin';
import { documentImagePrefix } from '../src/document-image';
import type { DocumentRemovalStore, RemovableDocument } from '../src/document-lifecycle';
import { instantAvailability, type InstantDate } from '../src/instant-wire';

// `$files.id` is an Instant storage id, not the image id the editor handed out. It is
// captured with the document that owns it and never leaves this adapter.
type InstantFile = { id: string; path?: string | null };
type InstantDocument = {
  id: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

function ownedFileIds(documentId: string, files: InstantFile[]) {
  const prefix = documentImagePrefix(documentId);
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
      return (data.documents ?? []).map((document) => {
        const fileIds = ownedFileIds(document.id, files);
        return {
          id: document.id,
          ...instantAvailability(document),
          async remove() {
            await db.transact([
              ...fileIds.map((fileId) => db.tx.$files[fileId].delete()),
              db.tx.documents[document.id].delete(),
            ]);
            return fileIds.length;
          },
        };
      });
    },
  };
}
