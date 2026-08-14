export const SHARE_PATH_PREFIX = '/s/';
export const EDIT_PATH_PREFIX = '/e/';
export const EDITOR_PATH = '/new';

export type Route =
  | { kind: 'home' }
  | { kind: 'editor' }
  | { kind: 'share'; documentId: string }
  | { kind: 'edit'; editId: string }
  | { kind: 'unavailable' };

function tokenAfter(pathname: string, prefix: string) {
  const match = new RegExp(`^${prefix}([^/]+)$`).exec(pathname);
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function recognizeRoute(pathname: string): Route {
  if (pathname === '/') return { kind: 'home' };
  if (pathname === EDITOR_PATH) return { kind: 'editor' };

  if (pathname.startsWith(SHARE_PATH_PREFIX)) {
    const documentId = tokenAfter(pathname, SHARE_PATH_PREFIX);
    return documentId ? { kind: 'share', documentId } : { kind: 'unavailable' };
  }

  if (pathname.startsWith(EDIT_PATH_PREFIX)) {
    const editId = tokenAfter(pathname, EDIT_PATH_PREFIX);
    return editId ? { kind: 'edit', editId } : { kind: 'unavailable' };
  }

  return { kind: 'unavailable' };
}

export function sharePath(id: string) {
  return `${SHARE_PATH_PREFIX}${encodeURIComponent(id)}`;
}

export function editPath(editId: string) {
  return `${EDIT_PATH_PREFIX}${encodeURIComponent(editId)}`;
}

export function shareUrl(id: string) {
  return new URL(sharePath(id), window.location.origin).toString();
}

export function editUrl(editId: string) {
  return new URL(editPath(editId), window.location.origin).toString();
}

export function pushPath(path: string) {
  window.history.pushState({}, '', path);
}

export function replacePath(path: string) {
  window.history.replaceState({}, '', path);
}

export function onPathChange(listener: () => void) {
  window.addEventListener('popstate', listener);
  return () => window.removeEventListener('popstate', listener);
}
