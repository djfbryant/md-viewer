export const SHARE_PATH_PREFIX = '/s/';

export function documentTitle(markdown: string) {
  return markdown.split('\n').find((line) => line.startsWith('# '))?.slice(2).trim() || 'Untitled document';
}

export function getShareId(pathname: string) {
  const match = new RegExp(`^${SHARE_PATH_PREFIX}([^/]+)$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function sharePath(id: string) {
  return `${SHARE_PATH_PREFIX}${encodeURIComponent(id)}`;
}

export function shareUrl(id: string) {
  return new URL(sharePath(id), window.location.origin).toString();
}
