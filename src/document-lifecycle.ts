import { createContext, useContext, useEffect, useState } from 'react';
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

export type DocumentImageSources = Record<string, string>;

export type SharedDocument = {
  id: string;
  title: string;
  markdown: string;
  expiresAt?: Date;
  imageSources?: DocumentImageSources;
};

export type DocumentRole = 'owner' | 'editor';

export type EditableDocument = SharedDocument & {
  role: DocumentRole;
  editors: ClubCreator[];
};

export type DocumentHandle = Pick<SharedDocument, 'id'>;

/** One Document as the library lists it. Availability travels with it so one module can age the list. */
export type CreatorLibraryEntry = {
  id: string;
  title: string;
} & DocumentAvailability;

export type CreatorLibrary = {
  loading: boolean;
  owned: CreatorLibraryEntry[];
  granted: CreatorLibraryEntry[];
};

export type ClubCreator = {
  userId: string;
  email: string;
};

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
  | { kind: 'published'; document: SharedDocument }
  | { kind: 'not-configured' }
  | { kind: 'forbidden' }
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
  | { kind: 'forbidden' }
  | { kind: 'failed' };

export type GrantEditorOutcome =
  | { kind: 'granted' }
  | { kind: 'revoked' }
  | { kind: 'unknown' }
  | { kind: 'not-configured' }
  | { kind: 'forbidden' }
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
  expiresAt?: Date | null;
};

/**
 * An image record a store already holds, named by the id `attachImage` handed out.
 * How the store keys its own file rows is its business and stays behind the seam.
 */
export type StoredImage = {
  id: string;
  expiresAt?: Date | null;
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
  role?: DocumentRole;
  editors?: ClubCreator[];
  images?: PersistedImage[];
};

export type PersistedShareOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: PersistedDocument };

export type StoredDocument = DocumentAvailability & {
  id: string;
  title: string;
  markdown: string;
  createdAt?: Date;
  updatedAt: Date;
  ownerUserId?: string;
};

/**
 * A cleanup candidate that knows how to act on itself. The store that listed it already
 * holds its image records, so neither the image ids nor their id space cross the seam.
 */
export type RemovableDocument = DocumentAvailability & {
  id: string;
  images: StoredImage[];
  /** Removes this document and every image it owns. Answers how many images went. */
  remove(): Promise<number>;
  /**
   * Removes the named images and rewrites the markdown that survives them. The rewrite is
   * handed down rather than applied here so the store runs it on the markdown it holds now,
   * not on a copy that went stale while cleanup worked through the rest of the list.
   */
  removeImages(imageIds: string[], rewriteMarkdown: (markdown: string) => string): Promise<void>;
  /** Stamps a retention date on an image stored before images had one. */
  setImageExpiry(imageId: string, expiresAt: Date): Promise<void>;
};

export interface DocumentPersistence {
  save(document: StoredDocument): Promise<'published' | 'not-configured' | 'forbidden'>;
  uploadImage(documentId: string, image: PendingDocumentImage, expiresAt: Date): Promise<'uploaded' | 'not-configured'>;
  removeImages(documentId: string, imageIds: string[]): Promise<void>;
  listImages(documentId: string): Promise<StoredImage[]>;
  // Reads are live and therefore hook-shaped. The query itself, its rule parameters, and
  // its wire types stay in the adapter; callers only ever see a PersistedShareOutcome.
  useShareDocument(id: string): PersistedShareOutcome;
  useEditDocument(id: string, userId: string | null): PersistedShareOutcome;
  useCreatorLibrary(userId: string | null): CreatorLibrary;
  useClubCreators(userId: string | null): ClubCreator[];
  markDeleted(id: string, deletedAt: Date): Promise<'deleted' | 'not-configured' | 'forbidden'>;
  grantEditor(id: string, editorUserId: string): Promise<'granted' | 'not-configured' | 'forbidden'>;
  revokeEditor(id: string, editorUserId: string): Promise<'revoked' | 'not-configured' | 'forbidden'>;
  findCreatorUserId(email: string): Promise<string | null>;
}

/** Admin-side removal. A browser cannot delete `$files`, so this is a second seam, not a second copy. */
export interface DocumentRemovalStore {
  listDocuments(): Promise<RemovableDocument[]>;
}

export interface DocumentLifecycle {
  attachImage(file: ImageInput, currentImageCount: number): AttachImageOutcome;
  save(markdown: string, existing?: DocumentHandle, options?: SaveDocumentOptions, ownerUserId?: string): Promise<SaveDocumentOutcome>;
  useShareDocument(id: string): ShareDocumentOutcome;
  useEditDocument(id: string, userId: string | null): EditDocumentOutcome;
  useCreatorLibrary(userId: string | null): CreatorLibrary;
  useClubCreators(userId: string | null): ClubCreator[];
  grantEditor(existing: DocumentHandle, email: string): Promise<GrantEditorOutcome>;
  revokeEditor(existing: DocumentHandle, editorUserId: string): Promise<GrantEditorOutcome>;
  delete(existing: DocumentHandle): Promise<DeleteDocumentOutcome>;
}

export function isDocumentUnavailable(document: DocumentAvailability, at: Date): boolean {
  if (document.deletedAt) return true;
  return document.expiresAt != null && document.expiresAt.getTime() <= at.getTime();
}

/**
 * Schedules a re-render when the next availability date passes. The lifecycle owns the
 * clock so callers never hand-roll expiry timers: an outcome that is available now simply
 * becomes unavailable at its date, in every component that renders it.
 */
function useAvailabilityClock(dates: Array<Date | null | undefined>): void {
  const [tick, setTick] = useState(0);
  const scheduleKey = dates.map((date) => date?.getTime() ?? '').join(',');
  useEffect(() => {
    const nextWake = dates
      .filter((date): date is Date => Boolean(date))
      .map((date) => date.getTime() - Date.now())
      .filter((delay) => delay > 0)
      .sort((a, b) => a - b)[0];
    if (nextWake === undefined) return;
    const timeout = window.setTimeout(
      () => setTick((current) => current + 1),
      Math.min(nextWake, 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [scheduleKey, tick]);
}

const DocumentLifecycleContext = createContext<DocumentLifecycle | null>(null);
export const DocumentLifecycleProvider = DocumentLifecycleContext.Provider;

/** The one seam between the interface and every caller: production binds the Instant adapter, tests bind memory. */
export function useDocumentLifecycle(): DocumentLifecycle {
  const lifecycle = useContext(DocumentLifecycleContext);
  if (!lifecycle) throw new Error('DocumentLifecycleProvider is missing from the tree.');
  return lifecycle;
}

/** An image outlives neither its own retention date nor the document that owns it. */
export function isImageExpired(expiresAt: Date | null | undefined, at: Date): boolean {
  return expiresAt != null && expiresAt.getTime() <= at.getTime();
}

function liveImageIds(images: StoredImage[], at: Date) {
  return images.filter((image) => !isImageExpired(image.expiresAt, at)).map((image) => image.id);
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
  const recordPublishedAbuse = (existing: DocumentHandle | undefined, imageCount: number, at: number) => {
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
    async save(markdown, existing, options, ownerUserId) {
      const timestamp = now();
      const at = timestamp.getTime();
      const storedImages = existing ? await persistence.listImages(existing.id) : [];
      const live = new Set(liveImageIds(storedImages, timestamp));
      const pending = new Set((options?.images ?? []).map((image) => image.id));

      // A ref to an image that has aged out, or was never uploaded, cannot render. Replace
      // it here so the document a reader opens never points at something that is gone.
      const dead = [...referencedDocumentImageIds(markdown)].filter((id) => !live.has(id) && !pending.has(id));
      const workingMarkdown = dead.length ? rewriteRemovedImageRefs(markdown, new Set(dead)) : markdown;

      const referenced = referencedDocumentImageIds(workingMarkdown);
      const unreferenced = storedImages.map((image) => image.id).filter((id) => !referenced.has(id));
      const uploads = (options?.images ?? []).filter((image) => referenced.has(image.id) && !live.has(image.id));
      const imageCount = uploads.length;

      if (!existing && !hasAbuseCapacity(abuseStore.load(ABUSE_CREATE_KEY), abuseLimits.create, at, 1)) {
        return { kind: 'rate-limited', limit: 'create' };
      }
      if (imageCount && !hasAbuseCapacity(abuseStore.load(ABUSE_UPLOAD_KEY), abuseLimits.upload, at, imageCount)) {
        return { kind: 'rate-limited', limit: 'upload' };
      }
      if (uploads.some((image) => image.file.size > MAX_IMAGE_BYTES || !isSupportedImageType(image.file.type))) {
        return { kind: 'failed' };
      }
      if (liveDocumentImageCount(workingMarkdown, live, uploads.map((image) => image.id)) > MAX_IMAGES_PER_DOCUMENT) {
        return { kind: 'failed' };
      }

      const id = existing?.id ?? generateId();
      const interpreted = interpretMarkdown(workingMarkdown);
      const expiresAt = options && 'expiresAt' in options ? options.expiresAt : undefined;
      const document = {
        id,
        title: interpreted.title,
        markdown: workingMarkdown,
        updatedAt: timestamp,
        ...(existing ? {} : { createdAt: timestamp, ownerUserId }),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };

      const uploadedIds: string[] = [];
      const discardUploaded = async () => {
        if (!uploadedIds.length) return;
        try {
          await persistence.removeImages(id, uploadedIds);
        } catch {
          // Compensation is best-effort; document cleanup still removes leftovers.
        }
      };

      try {
        for (const image of uploads) {
          const uploaded = await persistence.uploadImage(id, image, imageExpiresAt(timestamp));
          if (uploaded === 'not-configured') {
            await discardUploaded();
            return { kind: 'not-configured' };
          }
          uploadedIds.push(image.id);
        }
        const result = await persistence.save(document);
        if (result === 'not-configured') {
          await discardUploaded();
          return { kind: 'not-configured' };
        }
        if (result === 'forbidden') {
          await discardUploaded();
          return { kind: 'forbidden' };
        }
        if (unreferenced.length) {
          try {
            await persistence.removeImages(id, unreferenced);
          } catch {
            // Leftover files are cleanup's work. The rewritten document already published.
          }
        }
        recordPublishedAbuse(existing, imageCount, at);
        return {
          kind: 'published',
          document: {
            id: document.id,
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
      const persisted = persistence.useShareDocument(id);
      useAvailabilityClock([persisted.kind === 'available' ? persisted.document.expiresAt : null]);
      return toShareOutcome(persisted, now());
    },
    useEditDocument(id, userId) {
      const persisted = persistence.useEditDocument(id, userId);
      useAvailabilityClock([persisted.kind === 'available' ? persisted.document.expiresAt : null]);
      const outcome = toShareOutcome(persisted, now());
      if (outcome.kind !== 'available' || persisted.kind !== 'available' || !persisted.document.role) {
        return { kind: outcome.kind === 'loading' ? 'loading' : 'unavailable' };
      }
      return {
        kind: 'available',
        document: { ...outcome.document, role: persisted.document.role, editors: persisted.document.editors ?? [] },
      };
    },
    useCreatorLibrary(userId) {
      const library = persistence.useCreatorLibrary(userId);
      // The lifecycle owns expiry here too: entries age out of the list on their own dates.
      useAvailabilityClock([...library.owned, ...library.granted].map((entry) => entry.expiresAt));
      const at = now();
      const visible = (entries: CreatorLibraryEntry[]) => (
        entries.filter((entry) => !isDocumentUnavailable(entry, at)).map(({ id, title }) => ({ id, title }))
      );
      return { loading: library.loading, owned: visible(library.owned), granted: visible(library.granted) };
    },
    useClubCreators(userId) {
      return persistence.useClubCreators(userId);
    },
    async grantEditor(existing, email) {
      try {
        const editorUserId = await persistence.findCreatorUserId(email);
        if (!editorUserId) return { kind: 'unknown' };
        const result = await persistence.grantEditor(existing.id, editorUserId);
        if (result === 'not-configured') return { kind: 'not-configured' };
        if (result === 'forbidden') return { kind: 'forbidden' };
        return { kind: 'granted' };
      } catch {
        return { kind: 'failed' };
      }
    },
    async revokeEditor(existing, editorUserId) {
      try {
        const result = await persistence.revokeEditor(existing.id, editorUserId);
        if (result === 'not-configured') return { kind: 'not-configured' };
        if (result === 'forbidden') return { kind: 'forbidden' };
        return { kind: 'revoked' };
      } catch {
        return { kind: 'failed' };
      }
    },
    async delete(existing) {
      try {
        const result = await persistence.markDeleted(existing.id, now());
        if (result === 'not-configured') return { kind: 'not-configured' };
        if (result === 'forbidden') return { kind: 'forbidden' };
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
      const expiredImages: Array<{ documentId: string; imageCount: number }> = [];

      for (const document of await removal.listDocuments()) {
        // Images stored before retention existed have no date. Give them one from this run
        // rather than treating a missing date as "never expires".
        const images: StoredImage[] = [];
        for (const image of document.images) {
          if (image.expiresAt) {
            images.push(image);
            continue;
          }
          const expiresAt = imageExpiresAt(at);
          await document.setImageExpiry(image.id, expiresAt);
          images.push({ ...image, expiresAt });
        }

        if (isDocumentUnavailable(document, at)) {
          removed.push({ documentId: document.id, imageCount: await document.remove() });
          continue;
        }

        const due = images.filter((image) => isImageExpired(image.expiresAt, at)).map((image) => image.id);
        if (!due.length) continue;

        await document.removeImages(due, (markdown) => rewriteRemovedImageRefs(markdown, new Set(due)));
        expiredImages.push({ documentId: document.id, imageCount: due.length });
      }

      return { kind: 'cleaned', removed, expiredImages };
    } catch {
      return { kind: 'failed' };
    }
  };
}
