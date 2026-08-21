import { lookup } from '@instantdb/react';
import { documentImagePath, documentImagePrefix } from '../document-image';
import {
  createDocumentLifecycle,
  createLocalStorageAbuseStore,
  type ClubCreator,
  type CreatorLibrary,
  type CreatorLibraryEntry,
  type DocumentPersistence,
  type PersistedDocument,
  type PersistedImage,
  type PersistedShareOutcome,
} from '../document-lifecycle';
import { instantAvailability, ownedImageFiles, toDate, type InstantDate } from '../instant-wire';
import { createDocumentId, db } from './instant';

type Database = NonNullable<typeof db>;

type InstantFile = { id: string; path?: string | null; url?: string | null; expiresAt?: InstantDate | null };
type InstantUser = { id: string; email?: string | null };
type InstantDocument = {
  id: string;
  title: string;
  markdown: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
  owner?: InstantUser | InstantUser[] | null;
  editors?: InstantUser[] | null;
};

// Every read and write on a document's files is gated by the perms rule
// `data.id == ruleParams.knownDocumentId`. Resolving that gate here — once, in these two
// helpers — keeps Instant's permission model behind the seam instead of threaded through
// every method.
const scopedQuery = (documentId: string) => ({ ruleParams: { knownDocumentId: documentId } });

const fileTx = (database: Database, documentId: string, imageId: string) => (
  database.tx.$files[lookup('path', documentImagePath(documentId, imageId))]
    .ruleParams({ knownDocumentId: documentId })
);

function imagesFor(documentId: string, files: InstantFile[] | undefined): PersistedImage[] {
  return ownedImageFiles<InstantFile>(documentId, files).flatMap(({ imageId, file }) => (
    file.url ? [{ id: imageId, url: file.url, expiresAt: toDate(file.expiresAt) }] : []
  ));
}

function asUser(value: InstantUser | InstantUser[] | null | undefined) {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function roleFor(document: InstantDocument, userId: string) {
  if (asUser(document.owner)?.id === userId) return 'owner' as const;
  if ((document.editors ?? []).some((editor) => editor.id === userId)) return 'editor' as const;
  return undefined;
}

function persistedDocument(document: InstantDocument, files: InstantFile[] | undefined): PersistedDocument {
  return {
    id: document.id,
    title: document.title,
    markdown: document.markdown,
    ...instantAvailability(document),
    images: imagesFor(document.id, files),
  };
}

const emptyLibrary: CreatorLibrary = { loading: false, owned: [], granted: [] };

const instantDocumentPersistence: DocumentPersistence = {
  async save(document) {
    if (!db) return 'not-configured';
    if (!document.ownerUserId && document.createdAt) return 'forbidden';

    const write = db.tx.documents[document.id].update({
      title: document.title,
      markdown: document.markdown,
      updatedAt: document.updatedAt,
      ...(document.createdAt ? { createdAt: document.createdAt } : {}),
      ...('expiresAt' in document ? { expiresAt: document.expiresAt } : {}),
    });
    await db.transact(document.ownerUserId && document.createdAt
      ? write.link({ owner: document.ownerUserId })
      : write);
    return 'published';
  },

  async uploadImage(documentId, image, expiresAt) {
    const database = db;
    if (!database) return 'not-configured';
    const path = documentImagePath(documentId, image.id);
    await database.storage.uploadFile(path, image.file, {
      contentDisposition: 'inline',
      contentType: image.file.type || 'application/octet-stream',
    });
    // Retention is stamped in a second write because uploadFile cannot carry attributes.
    await database.transact(fileTx(database, documentId, image.id).update({ expiresAt }));
    return 'uploaded';
  },

  async removeImages(documentId, imageIds) {
    const database = db;
    if (!database || !imageIds.length) return;
    await database.transact(imageIds.map((imageId) => fileTx(database, documentId, imageId).delete()));
  },

  async listImages(documentId) {
    if (!db) return [];
    const { data } = await db.queryOnce(
      { $files: { $: { where: { path: { $like: `${documentImagePrefix(documentId)}%` } } } } },
      scopedQuery(documentId),
    );
    return imagesFor(documentId, data.$files).map(({ id, expiresAt }) => ({ id, expiresAt }));
  },

  useShareDocument(id): PersistedShareOutcome {
    if (!db) return { kind: 'unavailable' };

    const { data, error, isLoading } = db.useQuery(
      {
        documents: { $: { where: { id } } },
        $files: { $: { where: { path: { $like: `${documentImagePrefix(id)}%` } } } },
      },
      scopedQuery(id),
    );

    if (isLoading) return { kind: 'loading' };
    const document = data?.documents[0];
    return error || !document
      ? { kind: 'unavailable' }
      : { kind: 'available', document: persistedDocument(document, data.$files) };
  },

  useEditDocument(id, userId): PersistedShareOutcome {
    if (!db) return { kind: 'unavailable' };

    const documentQuery = db.useQuery(
      id && userId
        ? { documents: { $: { where: { id } }, owner: {}, editors: {} } }
        : null,
    );
    const document = documentQuery.data?.documents[0] as InstantDocument | undefined;
    const role = userId && document ? roleFor(document, userId) : undefined;
    const filesQuery = db.useQuery(
      document?.id
        ? { $files: { $: { where: { path: { $like: `${documentImagePrefix(document.id)}%` } } } } }
        : null,
      document?.id ? scopedQuery(document.id) : undefined,
    );

    if (!id || !userId) return { kind: 'unavailable' };
    if (documentQuery.isLoading || (document && filesQuery.isLoading)) return { kind: 'loading' };
    return documentQuery.error || !document || !role
      ? { kind: 'unavailable' }
      : {
        kind: 'available',
        document: {
          ...persistedDocument(document, filesQuery.data?.$files),
          role,
          editors: (document.editors ?? []).flatMap((editor) => editor.email ? [{ userId: editor.id, email: editor.email }] : []),
        },
      };
  },

  useCreatorLibrary(userId): CreatorLibrary {
    if (!db) return emptyLibrary;
    const ownedQuery = db.useQuery(userId ? { documents: { $: { where: { 'owner.id': userId } } } } : null);
    const grantedQuery = db.useQuery(userId ? { documents: { $: { where: { 'editors.id': userId } } } } : null);
    if (!userId) return emptyLibrary;
    // Availability travels with each entry; the lifecycle owns when entries leave the list.
    const listed = (documents: InstantDocument[] | undefined): CreatorLibraryEntry[] => (
      (documents ?? []).map((document) => ({
        id: document.id,
        title: document.title,
        ...instantAvailability(document),
      }))
    );
    return {
      loading: ownedQuery.isLoading || grantedQuery.isLoading,
      owned: listed(ownedQuery.data?.documents as InstantDocument[] | undefined),
      granted: listed(grantedQuery.data?.documents as InstantDocument[] | undefined),
    };
  },

  useClubCreators(userId): ClubCreator[] {
    if (!db) return [];
    const { data } = db.useQuery(userId ? { creators: { user: {} } } : null);
    if (!userId) return [];
    return (data?.creators ?? []).flatMap((creator: { email: string; user?: InstantUser | InstantUser[] | null }) => {
      const user = asUser(creator.user);
      return user?.id ? [{ userId: user.id, email: creator.email }] : [];
    });
  },

  async markDeleted(id, deletedAt) {
    if (!db) return 'not-configured';
    await db.transact(db.tx.documents[id].update({ deletedAt, updatedAt: deletedAt }));
    return 'deleted';
  },

  async grantEditor(id, editorUserId) {
    if (!db) return 'not-configured';
    await db.transact(db.tx.documents[id].link({ editors: editorUserId }));
    return 'granted';
  },

  async revokeEditor(id, editorUserId) {
    if (!db) return 'not-configured';
    await db.transact(db.tx.documents[id].unlink({ editors: editorUserId }));
    return 'revoked';
  },

  async findCreatorUserId(email) {
    if (!db) return null;
    const { data } = await db.queryOnce({ creators: { $: { where: { email } }, user: {} } });
    const user = asUser(data.creators[0]?.user as InstantUser | InstantUser[] | null);
    return user?.id ?? null;
  },
};

export const documentLifecycle = createDocumentLifecycle(
  instantDocumentPersistence,
  createDocumentId,
  () => new Date(),
  undefined,
  typeof localStorage === 'undefined' ? undefined : createLocalStorageAbuseStore(localStorage),
);
