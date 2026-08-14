export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES_PER_DOCUMENT = 20;
export const DOCUMENT_IMAGE_PATH_PREFIX = 'documents/';
export const DOCUMENT_IMAGE_SCHEME = 'markshare-image';

const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export type ImageInput = {
  name: string;
  size: number;
  type: string;
};

export type AttachImageOutcome =
  | { kind: 'attached'; image: { id: string; markdown: string } }
  | { kind: 'unsupported' }
  | { kind: 'too-large' }
  | { kind: 'too-many' };

export function isSupportedImageType(type: string) {
  return SUPPORTED_IMAGE_TYPES.has(type);
}

export function documentImagePath(documentId: string, imageId: string) {
  return `${DOCUMENT_IMAGE_PATH_PREFIX}${documentId}/${imageId}`;
}

export function documentImagePrefix(documentId: string) {
  return `${DOCUMENT_IMAGE_PATH_PREFIX}${documentId}/`;
}

export function imageIdFromPath(documentId: string, path: string) {
  const prefix = documentImagePrefix(documentId);
  if (!path.startsWith(prefix)) return undefined;
  const imageId = path.slice(prefix.length);
  return imageId && !imageId.includes('/') ? imageId : undefined;
}

export function parseDocumentImageRef(url: string) {
  const prefix = `${DOCUMENT_IMAGE_SCHEME}:`;
  if (!url.startsWith(prefix)) return undefined;
  const imageId = url.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(imageId) ? imageId : undefined;
}

export function isInstantStorageUrl(url: string) {
  try {
    const { hostname } = new URL(url.startsWith('//') ? `https:${url}` : url);
    return hostname === 'instant-storage.s3.amazonaws.com' || hostname.endsWith('.instant-storage.s3.amazonaws.com');
  } catch {
    return false;
  }
}

export function documentImageMarkdown(id: string, name: string) {
  const alt = name.replace(/[[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim() || 'pasted image';
  return `![${alt}](${DOCUMENT_IMAGE_SCHEME}:${id})`;
}

export function attachDocumentImage(
  file: ImageInput,
  currentImageCount: number,
  generateId: () => string,
): AttachImageOutcome {
  if (currentImageCount >= MAX_IMAGES_PER_DOCUMENT) return { kind: 'too-many' };
  if (!isSupportedImageType(file.type)) return { kind: 'unsupported' };
  if (file.size > MAX_IMAGE_BYTES) return { kind: 'too-large' };
  const id = generateId();
  return { kind: 'attached', image: { id, markdown: documentImageMarkdown(id, file.name) } };
}
