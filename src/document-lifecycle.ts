import { attachDocumentImage, isSupportedImageType, MAX_IMAGE_BYTES, type AttachImageOutcome, type ImageInput } from './document-image';
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
  | { kind: 'failed' };

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

export type RemovableDocument = {
  id: string;
  expiresAt?: InstantDate | null;
  deletedAt?: InstantDate | null;
  imageIds: string[];
};

export interface DocumentPersistence {
  save(document: StoredDocument): Promise<'published' | 'not-configured'>;
  uploadImages(documentId: string, images: PendingDocumentImage[]): Promise<'uploaded' | 'not-configured'>;
  useShareDocument(id: string): PersistedShareOutcome;
  useEditDocument(editId: string): PersistedShareOutcome;
  markDeleted(id: string, editId: string, deletedAt: Date): Promise<'deleted' | 'not-configured'>;
  rotateEditId(id: string, editId: string, nextEditId: string): Promise<'rotated' | 'not-configured'>;
}

export interface DocumentRemovalStore {
  listDocuments(): Promise<RemovableDocument[]>;
  removeDocumentAndImages(id: string, imageIds: string[]): Promise<void>;
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

export function createDocumentLifecycle(
  persistence: DocumentPersistence,
  generateId: () => string,
  now: () => Date = () => new Date(),
  removal?: DocumentRemovalStore,
): DocumentLifecycle {
  return {
    attachImage(file, currentImageCount) {
      return attachDocumentImage(file, currentImageCount, generateId);
    },
    async save(markdown, existing, options) {
      const id = existing?.id ?? generateId();
      const timestamp = now();
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

      try {
        if (options?.images?.length) {
          if (options.images.some((image) => image.file.size > MAX_IMAGE_BYTES || !isSupportedImageType(image.file.type))) {
            return { kind: 'failed' };
          }
          const uploaded = await persistence.uploadImages(id, options.images);
          if (uploaded === 'not-configured') return { kind: 'not-configured' };
        }
        const result = await persistence.save(document);
        if (result === 'not-configured') return { kind: 'not-configured' };
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

export async function cleanupDueDocuments(removal: DocumentRemovalStore, at: Date): Promise<CleanupDocumentOutcome> {
  try {
    const removed: Array<{ documentId: string; imageCount: number }> = [];
    for (const document of await removal.listDocuments()) {
      if (!isDocumentUnavailable(document, at)) continue;
      await removal.removeDocumentAndImages(document.id, document.imageIds);
      removed.push({ documentId: document.id, imageCount: document.imageIds.length });
    }
    return { kind: 'cleaned', removed };
  } catch {
    return { kind: 'failed' };
  }
}
