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
