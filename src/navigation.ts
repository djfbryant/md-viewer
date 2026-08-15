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

export const PUBLIC_PREVIEW_TITLE = 'MarkShare';
export const PUBLIC_PREVIEW_DESCRIPTION = 'A calm, private place to share Markdown.';
export const REFERRER_POLICY = 'no-referrer';
export const PRIVATE_ROBOTS = 'noindex, nofollow, noarchive';
export const PUBLIC_ROBOTS = 'index, follow';

export type RoutePrivacy = {
  pageTitle: string;
  robots: string;
  referrer: string;
  previewTitle: string;
  previewDescription: string;
};

function isPrivateRoute(route: Route) {
  return route.kind === 'share' || route.kind === 'edit' || route.kind === 'editor' || route.kind === 'unavailable';
}

export function privacyFor(route: Route, infoTitles?: Record<InfoPage, string>): RoutePrivacy {
  return {
    pageTitle: route.kind === 'info' && infoTitles ? `${infoTitles[route.page]} · MarkShare` : PUBLIC_PREVIEW_TITLE,
    robots: isPrivateRoute(route) ? PRIVATE_ROBOTS : PUBLIC_ROBOTS,
    referrer: REFERRER_POLICY,
    previewTitle: PUBLIC_PREVIEW_TITLE,
    previewDescription: PUBLIC_PREVIEW_DESCRIPTION,
  };
}

export function robotsTxt() {
  return ['User-agent: *', 'Allow: /', 'Disallow: /s/', 'Disallow: /e/', 'Disallow: /new', ''].join('\n');
}

export function responseHeadersFor(pathname: string) {
  const privacy = privacyFor(recognizeRoute(pathname));
  return [
    { key: 'X-Robots-Tag', value: privacy.robots },
    { key: 'Referrer-Policy', value: privacy.referrer },
  ];
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
