import {
  attachDocumentImage,
  imageExpiresAt,
  isSupportedImageType,
  liveDocumentImageCount,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_DOCUMENT,
  referencedDocumentImageIds,
  rewriteRemovedImageRefs,
  type AttachImageOutcome,
  type ImageInput,
} from './document-image';
import { interpretMarkdown } from './markdown';

export type InstantDate = Date | number | string;

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
  | {
      kind: 'cleaned';
      removed: Array<{ documentId: string; imageCount: number }>;
      expiredImages: Array<{ documentId: string; imageCount: number }>;
    }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

export type PersistedImage = {
  id: string;
  url: string;
  expiresAt?: InstantDate | null;
};

export type PersistedDocument = {
  id: string;
  title: string;
  markdown: string;
  editId?: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
  images?: PersistedImage[];
};

export type PersistedShareOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: PersistedDocument };

type StoredDocument = {
  id: string;
  editId: string;
  title: string;
  markdown: string;
  createdAt?: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
  deletedAt?: Date | null;
};

export type RemovableImage = {
  id: string;
  fileId: string;
  expiresAt?: InstantDate | null;
};

export type RemovableDocument = {
  id: string;
  markdown: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
  images: RemovableImage[];
};

export interface DocumentPersistence {
  save(document: StoredDocument): Promise<'published' | 'not-configured'>;
  uploadImages(documentId: string, images: PendingDocumentImage[], editId: string, uploadedAt: Date): Promise<'uploaded' | 'not-configured'>;
  removeImages(documentId: string, imageIds: string[], editId: string): Promise<void>;
  listImages(documentId: string): Promise<RemovableImage[]>;
  useShareDocument(id: string): PersistedShareOutcome;
  useEditDocument(editId: string): PersistedShareOutcome;
  markDeleted(id: string, editId: string, deletedAt: Date): Promise<'deleted' | 'not-configured'>;
  rotateEditId(id: string, editId: string, nextEditId: string): Promise<'rotated' | 'not-configured'>;
}

export interface DocumentRemovalStore {
  listDocuments(): Promise<RemovableDocument[]>;
  removeDocumentAndImages(id: string, images: RemovableImage[]): Promise<void>;
  removeImagesAndUpdateMarkdown(id: string, images: RemovableImage[]): Promise<void>;
  backfillImageExpiry(image: RemovableImage, expiresAt: Date): Promise<void>;
}

export interface DocumentLifecycle {
  attachImage(file: ImageInput, currentImageCount: number): AttachImageOutcome;
  save(markdown: string, existing?: EditCapability, options?: SaveDocumentOptions): Promise<SaveDocumentOutcome>;
  useShareDocument(id: string): ShareDocumentOutcome;
  useEditDocument(editId: string): EditDocumentOutcome;
  rotate(existing: EditCapability): Promise<RotateDocumentOutcome>;
  delete(existing: EditCapability): Promise<DeleteDocumentOutcome>;
  cleanup(): Promise<CleanupDocumentOutcome>;
}

export function toDate(value: InstantDate | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isDocumentUnavailable(document: Pick<PersistedDocument, 'expiresAt' | 'deletedAt'>, at: Date): boolean {
  if (toDate(document.deletedAt)) return true;
  const expiresAt = toDate(document.expiresAt);
  return expiresAt != null && expiresAt.getTime() <= at.getTime();
}

export function isImageExpired(expiresAt: InstantDate | null | undefined, at: Date): boolean {
  const expiry = toDate(expiresAt);
  return expiry != null && expiry.getTime() <= at.getTime();
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

function liveStoredImageIds(images: RemovableImage[], at: Date) {
  return images.filter((image) => !isImageExpired(image.expiresAt, at)).map((image) => image.id);
}

export function createDocumentLifecycle(
  persistence: DocumentPersistence,
  generateId: () => string,
  now: () => Date = () => new Date(),
  removal?: DocumentRemovalStore,
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
      const storedImages = existing ? await persistence.listImages(existing.id) : [];
      const liveStored = new Set(liveStoredImageIds(storedImages, timestamp));
      const pendingIds = new Set((options?.images ?? []).map((image) => image.id));
      let workingMarkdown = markdown;

      const deadRefs = [...referencedDocumentImageIds(workingMarkdown)].filter((id) => (
        !liveStored.has(id) && !pendingIds.has(id)
      ));
      if (deadRefs.length) {
        workingMarkdown = rewriteRemovedImageRefs(workingMarkdown, new Set(deadRefs));
      }

      const referenced = referencedDocumentImageIds(workingMarkdown);
      const unreferenced = storedImages
        .map((image) => image.id)
        .filter((id) => !referenced.has(id));

      const newUploads = (options?.images ?? []).filter((image) => referenced.has(image.id) && !liveStored.has(image.id));
      const imageCount = newUploads.length;
      if (!existing && !hasAbuseCapacity(abuseStore.load(ABUSE_CREATE_KEY), abuseLimits.create, at, 1)) {
        return { kind: 'rate-limited', limit: 'create' };
      }
      if (imageCount && !hasAbuseCapacity(abuseStore.load(ABUSE_UPLOAD_KEY), abuseLimits.upload, at, imageCount)) {
        return { kind: 'rate-limited', limit: 'upload' };
      }

      if (newUploads.some((image) => image.file.size > MAX_IMAGE_BYTES || !isSupportedImageType(image.file.type))) {
        return { kind: 'failed' };
      }
      if (liveDocumentImageCount(workingMarkdown, liveStored, newUploads.map((image) => image.id)) > MAX_IMAGES_PER_DOCUMENT) {
        return { kind: 'failed' };
      }

      const id = existing?.id ?? generateId();
      const interpreted = interpretMarkdown(workingMarkdown);
      const expiresAt = options && 'expiresAt' in options ? options.expiresAt : undefined;
      const document = {
        id,
        editId: existing?.editId ?? generateId(),
        title: interpreted.title,
        markdown: workingMarkdown,
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
        if (newUploads.length) {
          for (const image of newUploads) {
            const uploaded = await persistence.uploadImages(id, [image], document.editId, timestamp);
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
        if (unreferenced.length) {
          try {
            await persistence.removeImages(id, unreferenced, document.editId);
          } catch {
            // Leftover files are cleanup work. The rewritten document already published.
          }
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
    async cleanup() {
      if (!removal) return { kind: 'not-configured' };
      return cleanupDueDocuments(removal, now());
    },
  };
}

function toShareOutcome(outcome: PersistedShareOutcome, at: Date): ShareDocumentOutcome {
  if (outcome.kind !== 'available') return outcome;
  if (isDocumentUnavailable(outcome.document, at)) return { kind: 'unavailable' };
  const expiresAt = toDate(outcome.document.expiresAt);
  const imageSources = Object.fromEntries(
    (outcome.document.images ?? [])
      .filter((image) => image.url && !isImageExpired(image.expiresAt, at))
      .map((image) => [image.id, image.url]),
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

export async function cleanupDueDocuments(removal: DocumentRemovalStore, at: Date): Promise<CleanupDocumentOutcome> {
  try {
    const removed: Array<{ documentId: string; imageCount: number }> = [];
    const expiredImages: Array<{ documentId: string; imageCount: number }> = [];

    for (const document of await removal.listDocuments()) {
      const images = [...document.images];
      for (const image of images) {
        if (!toDate(image.expiresAt)) {
          const expiresAt = imageExpiresAt(at);
          await removal.backfillImageExpiry(image, expiresAt);
          image.expiresAt = expiresAt;
        }
      }

      if (isDocumentUnavailable(document, at)) {
        await removal.removeDocumentAndImages(document.id, images);
        removed.push({ documentId: document.id, imageCount: images.length });
        continue;
      }

      const due = images.filter((image) => isImageExpired(image.expiresAt, at));
      if (!due.length) continue;

      await removal.removeImagesAndUpdateMarkdown(document.id, due);
      expiredImages.push({ documentId: document.id, imageCount: due.length });
    }

    return { kind: 'cleaned', removed, expiredImages };
  } catch {
    return { kind: 'failed' };
  }
}
