import { init } from '@instantdb/admin';
import { documentImagePrefix, imageIdFromPath } from '../src/document-image';
import type { DocumentRemovalStore, RemovableDocument, StoredImage } from '../src/document-lifecycle';
import { instantAvailability, toDate, type InstantDate } from '../src/instant-wire';

// `$files.id` is an Instant storage id, not the image id the editor handed out. Each
// document keeps its own map of the two, and neither the map nor the storage ids leave here.
type InstantFile = { id: string; path?: string | null; expiresAt?: InstantDate | null };
type InstantDocument = {
  id: string;
  markdown: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

export function ownedFiles(documentId: string, files: InstantFile[]) {
  const prefix = documentImagePrefix(documentId);
  const owned = new Map<string, { fileId: string; expiresAt: Date | null }>();
  for (const file of files) {
    const imageId = imageIdFromPath(documentId, file.path ?? '');
    if (imageId && file.path?.startsWith(prefix)) {
      owned.set(imageId, { fileId: file.id, expiresAt: toDate(file.expiresAt) });
    }
  }
  return owned;
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
        const owned = ownedFiles(document.id, files);
        const images: StoredImage[] = [...owned].map(([id, file]) => ({ id, expiresAt: file.expiresAt }));
        const fileIdsFor = (imageIds: string[]) => imageIds.flatMap((imageId) => {
          const file = owned.get(imageId);
          return file ? [file.fileId] : [];
        });

        return {
          id: document.id,
          ...instantAvailability(document),
          images,
          async remove() {
            await db.transact([
              ...[...owned.values()].map((file) => db.tx.$files[file.fileId].delete()),
              db.tx.documents[document.id].delete(),
            ]);
            return owned.size;
          },
          async removeImages(imageIds, rewriteMarkdown) {
            // Re-read: this document may have been edited since the run started.
            const current = await db.query({ documents: { $: { where: { id: document.id } } } }) as {
              documents?: InstantDocument[];
            };
            await db.transact([
              ...fileIdsFor(imageIds).map((fileId) => db.tx.$files[fileId].delete()),
              db.tx.documents[document.id].update({ markdown: rewriteMarkdown(current.documents?.[0]?.markdown ?? '') }),
            ]);
          },
          async setImageExpiry(imageId, expiresAt) {
            const file = owned.get(imageId);
            if (!file) return;
            await db.transact(db.tx.$files[file.fileId].update({ expiresAt }));
          },
        };
      });
    },
  };
}
