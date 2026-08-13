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
