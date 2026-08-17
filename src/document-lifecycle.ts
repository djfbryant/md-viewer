import { attachDocumentImage, isSupportedImageType, MAX_IMAGE_BYTES, MAX_IMAGES_PER_DOCUMENT, type AttachImageOutcome, type ImageInput } from './document-image';
import { interpretMarkdown } from './markdown';

export type DocumentImageSources = Record<string, string>;

export type SharedDocument = {
  id: string;
  title: string;
  markdown: string;
  expiresAt?: Date;
  imageSources?: DocumentImageSources;
};

export type EditableDocument = SharedDocument & {
  editId: string;
};

export type EditCapability = Pick<EditableDocument, 'id' | 'editId'>;

export type PendingDocumentImage = {
  id: string;
  file: Blob;
};

export type SaveDocumentOptions = {
  expiresAt?: Date | null;
  images?: PendingDocumentImage[];
};

export type ShareDocumentOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: SharedDocument };

export type SaveDocumentOutcome =
  | { kind: 'published'; document: EditableDocument }
  | { kind: 'not-configured' }
  | { kind: 'rate-limited'; limit: 'create' | 'upload' }
  | { kind: 'failed' };

export const CREATE_DOCUMENT_LIMIT = { max: 20, windowMs: 60 * 60 * 1000 };
export const UPLOAD_IMAGE_LIMIT = { max: 60, windowMs: 60 * 60 * 1000 };

export type AbuseLimits = {
  create: { max: number; windowMs: number };
  upload: { max: number; windowMs: number };
};

export type AbuseStore = {
  load(key: string): number[];
  save(key: string, values: number[]): void;
};

const ABUSE_CREATE_KEY = 'markshare-abuse-create-v1';
const ABUSE_UPLOAD_KEY = 'markshare-abuse-upload-v1';

export function createMemoryAbuseStore(): AbuseStore {
  const data = new Map<string, number[]>();
  return {
    load: (key) => [...(data.get(key) ?? [])],
    save: (key, values) => { data.set(key, [...values]); },
  };
}

export function createLocalStorageAbuseStore(storage: Pick<Storage, 'getItem' | 'setItem'>): AbuseStore {
  return {
    load(key) {
      try {
        const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
        return Array.isArray(parsed)
          ? parsed.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
          : [];
      } catch {
        return [];
      }
    },
    save(key, values) {
      try {
        storage.setItem(key, JSON.stringify(values));
      } catch {
        // Quota is a convenience. A blocked storage area must not prevent saving.
      }
    },
  };
}

export type DeleteDocumentOutcome =
  | { kind: 'deleted' }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

export type RotateDocumentOutcome =
  | { kind: 'rotated'; document: EditCapability }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

export type EditDocumentOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: EditableDocument };

export type CleanupDocumentOutcome =
  | { kind: 'cleaned'; removed: Array<{ documentId: string; imageCount: number }> }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

export type PersistedImage = {
  id: string;
  url: string;
};

/** When a document stops being readable. The one rule a reader and cleanup must agree on. */
export type DocumentAvailability = {
  expiresAt?: Date | null;
  deletedAt?: Date | null;
};

/** What a store returns for a read. Image ids are the ids `attachImage` handed out. */
export type PersistedDocument = DocumentAvailability & {
  id: string;
  title: string;
  markdown: string;
  images?: PersistedImage[];
};

export type PersistedShareOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: PersistedDocument };

export type StoredDocument = DocumentAvailability & {
  id: string;
  editId: string;
  title: string;
  markdown: string;
  createdAt?: Date;
  updatedAt: Date;
};

/**
 * A cleanup candidate that knows how to remove itself. The store that listed it already
 * holds its image records, so neither the image ids nor their id space cross the seam.
 */
export type RemovableDocument = DocumentAvailability & {
  id: string;
  /** Removes this document and every image it owns. Answers how many images went. */
  remove(): Promise<number>;
};

export interface DocumentPersistence {
  save(document: StoredDocument): Promise<'published' | 'not-configured'>;
  uploadImage(documentId: string, image: PendingDocumentImage): Promise<'uploaded' | 'not-configured'>;
  removeImages(documentId: string, imageIds: string[], editId: string): Promise<void>;
  listImageIds(documentId: string): Promise<string[]>;
  // Reads are live and therefore hook-shaped. The query itself, its rule parameters, and
  // its wire types stay in the adapter; callers only ever see a PersistedShareOutcome.
  useShareDocument(id: string): PersistedShareOutcome;
  useEditDocument(editId: string): PersistedShareOutcome;
  markDeleted(id: string, editId: string, deletedAt: Date): Promise<'deleted' | 'not-configured'>;
  rotateEditId(id: string, editId: string, nextEditId: string): Promise<'rotated' | 'not-configured'>;
}

/** Admin-side removal. A browser cannot delete `$files`, so this is a second seam, not a second copy. */
export interface DocumentRemovalStore {
  listDocuments(): Promise<RemovableDocument[]>;
}

export interface DocumentLifecycle {
  attachImage(file: ImageInput, currentImageCount: number): AttachImageOutcome;
  save(markdown: string, existing?: EditCapability, options?: SaveDocumentOptions): Promise<SaveDocumentOutcome>;
  useShareDocument(id: string): ShareDocumentOutcome;
  useEditDocument(editId: string): EditDocumentOutcome;
  rotate(existing: EditCapability): Promise<RotateDocumentOutcome>;
  delete(existing: EditCapability): Promise<DeleteDocumentOutcome>;
}

function isDocumentUnavailable(document: DocumentAvailability, at: Date): boolean {
  if (document.deletedAt) return true;
  return document.expiresAt != null && document.expiresAt.getTime() <= at.getTime();
}

function pruneWindow(times: number[], windowMs: number, at: number) {
  const cutoff = at - windowMs;
  while (times.length && times[0]! <= cutoff) times.shift();
}

function hasAbuseCapacity(times: number[], limit: { max: number; windowMs: number }, at: number, count: number) {
  pruneWindow(times, limit.windowMs, at);
  return times.length + count <= limit.max;
}

function recordAbuse(times: number[], at: number, count: number) {
  for (let index = 0; index < count; index += 1) times.push(at);
}

export function createDocumentLifecycle(
  persistence: DocumentPersistence,
  generateId: () => string,
  now: () => Date = () => new Date(),
  abuseLimits: AbuseLimits = { create: CREATE_DOCUMENT_LIMIT, upload: UPLOAD_IMAGE_LIMIT },
  abuseStore: AbuseStore = createMemoryAbuseStore(),
): DocumentLifecycle {
  const recordPublishedAbuse = (existing: EditCapability | undefined, imageCount: number, at: number) => {
    if (!existing) {
      const createTimes = abuseStore.load(ABUSE_CREATE_KEY);
      pruneWindow(createTimes, abuseLimits.create.windowMs, at);
      recordAbuse(createTimes, at, 1);
      abuseStore.save(ABUSE_CREATE_KEY, createTimes);
    }
    if (imageCount) {
      const uploadTimes = abuseStore.load(ABUSE_UPLOAD_KEY);
      pruneWindow(uploadTimes, abuseLimits.upload.windowMs, at);
      recordAbuse(uploadTimes, at, imageCount);
      abuseStore.save(ABUSE_UPLOAD_KEY, uploadTimes);
    }
  };

  return {
    attachImage(file, currentImageCount) {
      return attachDocumentImage(file, currentImageCount, generateId);
    },
    async save(markdown, existing, options) {
      const timestamp = now();
      const at = timestamp.getTime();
      const imageCount = options?.images?.length ?? 0;
      if (!existing && !hasAbuseCapacity(abuseStore.load(ABUSE_CREATE_KEY), abuseLimits.create, at, 1)) {
        return { kind: 'rate-limited', limit: 'create' };
      }
      if (imageCount && !hasAbuseCapacity(abuseStore.load(ABUSE_UPLOAD_KEY), abuseLimits.upload, at, imageCount)) {
        return { kind: 'rate-limited', limit: 'upload' };
      }
      const id = existing?.id ?? generateId();
      const interpreted = interpretMarkdown(markdown);
      const expiresAt = options && 'expiresAt' in options ? options.expiresAt : undefined;
      const document = {
        id,
        editId: existing?.editId ?? generateId(),
        title: interpreted.title,
        markdown,
        updatedAt: timestamp,
        ...(existing ? {} : { createdAt: timestamp }),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };

      const uploadedIds: string[] = [];
      const discardUploaded = async () => {
        if (!uploadedIds.length) return;
        try {
          await persistence.removeImages(id, uploadedIds, document.editId);
        } catch {
          // Compensation is best-effort; document cleanup still removes leftovers.
        }
      };

      try {
        if (options?.images?.length) {
          if (options.images.some((image) => image.file.size > MAX_IMAGE_BYTES || !isSupportedImageType(image.file.type))) {
            return { kind: 'failed' };
          }
          const storedIds = existing ? await persistence.listImageIds(existing.id) : [];
          const stored = new Set(storedIds);
          if (stored.size + options.images.filter((image) => !stored.has(image.id)).length > MAX_IMAGES_PER_DOCUMENT) {
            return { kind: 'failed' };
          }
          for (const image of options.images) {
            const uploaded = await persistence.uploadImage(id, image);
            if (uploaded === 'not-configured') {
              await discardUploaded();
              return { kind: 'not-configured' };
            }
            uploadedIds.push(image.id);
          }
        }
        const result = await persistence.save(document);
        if (result === 'not-configured') {
          await discardUploaded();
          return { kind: 'not-configured' };
        }
        recordPublishedAbuse(existing, imageCount, at);
        return {
          kind: 'published',
          document: {
            id: document.id,
            editId: document.editId,
            title: document.title,
            markdown: document.markdown,
            ...(expiresAt ? { expiresAt } : {}),
          },
        };
      } catch {
        await discardUploaded();
        return { kind: 'failed' };
      }
    },
    useShareDocument(id) {
      return toShareOutcome(persistence.useShareDocument(id), now());
    },
    useEditDocument(editId) {
      const outcome = toShareOutcome(persistence.useEditDocument(editId), now());
      if (!editId) return { kind: 'unavailable' };
      if (outcome.kind !== 'available') return outcome;
      return {
        kind: 'available',
        document: { ...outcome.document, editId },
      };
    },
    async rotate(existing) {
      try {
        const nextEditId = generateId();
        const result = await persistence.rotateEditId(existing.id, existing.editId, nextEditId);
        if (result === 'not-configured') return { kind: 'not-configured' };
        return { kind: 'rotated', document: { id: existing.id, editId: nextEditId } };
      } catch {
        return { kind: 'failed' };
      }
    },
    async delete(existing) {
      try {
        const result = await persistence.markDeleted(existing.id, existing.editId, now());
        if (result === 'not-configured') return { kind: 'not-configured' };
        return { kind: 'deleted' };
      } catch {
        return { kind: 'failed' };
      }
    },
  };
}

function toShareOutcome(outcome: PersistedShareOutcome, at: Date): ShareDocumentOutcome {
  if (outcome.kind !== 'available') return outcome;
  if (isDocumentUnavailable(outcome.document, at)) return { kind: 'unavailable' };
  const expiresAt = outcome.document.expiresAt;
  const imageSources = Object.fromEntries(
    (outcome.document.images ?? []).filter((image) => image.url).map((image) => [image.id, image.url]),
  );
  return {
    kind: 'available',
    document: {
      id: outcome.document.id,
      title: outcome.document.title,
      markdown: outcome.document.markdown,
      ...(expiresAt ? { expiresAt } : {}),
      ...(Object.keys(imageSources).length ? { imageSources } : {}),
    },
  };
}

/**
 * The removal half of the Document lifecycle. It shares the availability rule with the
 * reader, so a document a Share Link refuses is exactly a document cleanup removes.
 * A null store means the deployment has no admin credentials, not a failure.
 */
export function createDocumentCleanup(
  removal: DocumentRemovalStore | null,
  now: () => Date = () => new Date(),
): () => Promise<CleanupDocumentOutcome> {
  return async () => {
    if (!removal) return { kind: 'not-configured' };
    const at = now();
    try {
      const removed: Array<{ documentId: string; imageCount: number }> = [];
      for (const document of await removal.listDocuments()) {
        if (!isDocumentUnavailable(document, at)) continue;
        removed.push({ documentId: document.id, imageCount: await document.remove() });
      }
      return { kind: 'cleaned', removed };
    } catch {
      return { kind: 'failed' };
    }
  };
}
