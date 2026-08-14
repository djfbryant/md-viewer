export const SHARE_PATH_PREFIX = '/s/';

export function getShareId(pathname: string) {
  const match = new RegExp(`^${SHARE_PATH_PREFIX}([^/]+)$`).exec(pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function sharePath(id: string) {
  return `${SHARE_PATH_PREFIX}${encodeURIComponent(id)}`;
}

export function shareUrl(id: string) {
  return new URL(sharePath(id), window.location.origin).toString();
}

export function formatExpiry(expiresAt: Date | null | undefined) {
  if (!expiresAt) return 'Never expires';
  return `Expires ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(expiresAt)}`;
}

export function toDatetimeLocalValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
