export const SHARE_PATH_PREFIX = '/s/';
export const EDIT_PATH_PREFIX = '/e/';
export const EDITOR_PATH = '/new';
export const ABOUT_PATH = '/about';
export const PRIVACY_PATH = '/privacy';
export const ACCEPTABLE_USE_PATH = '/acceptable-use';

export type InfoPage = 'about' | 'privacy' | 'acceptable-use';

export type Route =
  | { kind: 'home' }
  | { kind: 'editor' }
  | { kind: 'info'; page: InfoPage }
  | { kind: 'share'; documentId: string }
  | { kind: 'edit'; editId: string }
  | { kind: 'unavailable' };

export const infoPath: Record<InfoPage, string> = {
  about: ABOUT_PATH,
  privacy: PRIVACY_PATH,
  'acceptable-use': ACCEPTABLE_USE_PATH,
};

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
  if (pathname === ABOUT_PATH || pathname === `${ABOUT_PATH}/`) return { kind: 'info', page: 'about' };
  if (pathname === PRIVACY_PATH || pathname === `${PRIVACY_PATH}/`) return { kind: 'info', page: 'privacy' };
  if (pathname === ACCEPTABLE_USE_PATH || pathname === `${ACCEPTABLE_USE_PATH}/`) return { kind: 'info', page: 'acceptable-use' };

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
