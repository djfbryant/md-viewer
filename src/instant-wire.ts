import { imageIdFromPath } from './document-image';
import type { DocumentAvailability } from './document-lifecycle';

/**
 * Instant returns `date` attributes as a Date, an epoch number, or an ISO string,
 * depending on SDK and transport. That variance is Instant's, so it is converted
 * inside the Instant adapters and never reaches the Document lifecycle.
 */
export type InstantDate = Date | number | string;

export function toDate(value: InstantDate | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The pair every Instant document row carries, resolved once for both adapters. */
export function instantAvailability(
  row: { expiresAt?: InstantDate | null; deletedAt?: InstantDate | null },
): DocumentAvailability {
  return { expiresAt: toDate(row.expiresAt), deletedAt: toDate(row.deletedAt) };
}

/**
 * The one mapping from Instant storage rows to the images a Document owns, keyed by the
 * image id the editor handed out. Both adapters read through this so the path scheme is
 * parsed in exactly one place; what each does with its own file rows stays behind its seam.
 */
export function ownedImageFiles<T extends { path?: string | null }>(
  documentId: string,
  files: T[] | null | undefined,
): Array<{ imageId: string; file: T }> {
  return (files ?? []).flatMap((file) => {
    const imageId = imageIdFromPath(documentId, file.path ?? '');
    return imageId ? [{ imageId, file }] : [];
  });
}
