import { init } from '@instantdb/admin';
import { documentImagePrefix, imageIdFromPath, rewriteRemovedImageRefs } from '../src/document-image';
import type { DocumentRemovalStore, InstantDate, RemovableDocument, RemovableImage } from '../src/document-lifecycle';

export type InstantOwnedFile = { id: string; path?: string | null; expiresAt?: InstantDate | null };
type InstantDocument = {
  id: string;
  markdown: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
};

export function ownedImages(documentId: string, files: InstantOwnedFile[]): RemovableImage[] {
  const prefix = documentImagePrefix(documentId);
  return files.flatMap((file) => {
    const imageId = imageIdFromPath(documentId, file.path ?? '');
    return imageId && file.path?.startsWith(prefix)
      ? [{ id: imageId, fileId: file.id, expiresAt: file.expiresAt }]
      : [];
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
        $files?: InstantOwnedFile[];
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
    async removeDocumentAndImages(id, images) {
      await db.transact([
        ...images.map((image) => db.tx.$files[image.fileId].delete()),
        db.tx.documents[id].delete(),
      ]);
    },
    async removeImagesAndUpdateMarkdown(id, images) {
      const data = await db.query({ documents: { $: { where: { id } } } }) as {
        documents?: InstantDocument[];
      };
      const rewritten = rewriteRemovedImageRefs(
        data.documents?.[0]?.markdown ?? '',
        new Set(images.map((image) => image.id)),
      );
      await db.transact([
        ...images.map((image) => db.tx.$files[image.fileId].delete()),
        db.tx.documents[id].update({ markdown: rewritten }),
      ]);
    },
    async backfillImageExpiry(image, expiresAt) {
      await db.transact(db.tx.$files[image.fileId].update({ expiresAt }));
    },
  };
}
