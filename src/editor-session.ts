import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DocumentHandle, DocumentLifecycle, EditableDocument, SaveDocumentOutcome } from './document-lifecycle';
import { IMAGE_TOO_LARGE_MESSAGE, imageTooManyMessage, liveDocumentImageCount, referencedDocumentImageIds } from './document-image';

const RECOVERY_KEY = 'markshare-editor-recovery-v1';
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;

type Recovery = {
  markdown: string;
  publishedMarkdown: string;
  publishedId: string | null;
};

const emptyRecovery: Recovery = { markdown: '', publishedMarkdown: '', publishedId: null };

function recoveryStorageKey(creatorEmail: string | null, documentId: string | null) {
  if (!creatorEmail) return RECOVERY_KEY;
  return documentId ? `${RECOVERY_KEY}:${creatorEmail}:${documentId}` : `${RECOVERY_KEY}:${creatorEmail}:new`;
}

function readRecovery(creatorEmail: string | null, documentId: string | null = null): Recovery {
  try {
    const raw = window.localStorage.getItem(recoveryStorageKey(creatorEmail, documentId));
    if (!raw) return emptyRecovery;
    const parsed = JSON.parse(raw) as Partial<Recovery>;
    if (typeof parsed.markdown !== 'string' || typeof parsed.publishedMarkdown !== 'string') return emptyRecovery;
    return {
      markdown: parsed.markdown,
      publishedMarkdown: parsed.publishedMarkdown,
      publishedId: typeof parsed.publishedId === 'string' ? parsed.publishedId : null,
    };
  } catch {
    return emptyRecovery;
  }
}

function persistRecovery(creatorEmail: string | null, documentId: string | null, recovery: Recovery) {
  try {
    const key = recoveryStorageKey(creatorEmail, documentId);
    if (recovery.markdown === recovery.publishedMarkdown) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(recovery));
  } catch {
    // Local recovery is a convenience. A blocked storage area must not prevent editing.
  }
}

function insertSnippet(markdown: string, snippet: string, start: number, end: number) {
  const padBefore = start > 0 && markdown[start - 1] !== '\n' ? '\n\n' : '';
  const padAfter = end < markdown.length && markdown[end] !== '\n' ? '\n\n' : '\n';
  return markdown.slice(0, start) + padBefore + snippet + padAfter + markdown.slice(end);
}

type PendingImage = {
  file?: File;
  id: string;
  previewUrl: string;
  uploaded: boolean;
};

export function useEditorSession(
  lifecycle: Pick<DocumentLifecycle, 'attachImage' | 'save' | 'delete'>,
  existing?: EditableDocument,
  creatorEmail?: string | null,
  ownerUserId?: string,
) {
  const [recovery] = useState(() => readRecovery(creatorEmail ?? null, existing?.id ?? null));
  const initialMarkdown = recovery.markdown && (!existing || recovery.publishedId === existing.id)
    ? recovery.markdown
    : (existing?.markdown ?? recovery.markdown);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [publishedMarkdown, setPublishedMarkdown] = useState(existing?.markdown ?? recovery.publishedMarkdown);
  const [publishedId, setPublishedId] = useState(existing?.id ?? recovery.publishedId);
  const [expiresAt, setExpiresAt] = useState<Date | null>(existing?.expiresAt ?? null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(Boolean(initialMarkdown && initialMarkdown !== (existing?.markdown ?? recovery.publishedMarkdown)));
  const [savedNotice, setSavedNotice] = useState(false);
  const activeId = useRef<string | null>(existing?.id ?? recovery.publishedId);
  const pendingImagesRef = useRef<PendingImage[]>([]);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  const hasUnsavedChanges = markdown !== publishedMarkdown;
  const handle: DocumentHandle | undefined = publishedId ? { id: publishedId } : undefined;
  const referencedImageIds = useMemo(() => referencedDocumentImageIds(markdown), [markdown]);
  const storedImageIds = useMemo(() => Object.keys(existing?.imageSources ?? {}), [existing?.imageSources]);
  const pendingReferencedIds = useMemo(
    () => pendingImages.filter((image) => referencedImageIds.has(image.id)).map((image) => image.id),
    [pendingImages, referencedImageIds],
  );
  const imageCount = liveDocumentImageCount(markdown, storedImageIds, pendingReferencedIds);
  // Stored sources win. Preview blobs stay until unmount or document switch so a
  // remote Instant URL can fetch without revoking the still-visible preview.
  const imageSources = useMemo(() => ({
    ...Object.fromEntries(pendingImages.map((image) => [image.id, image.previewUrl])),
    ...existing?.imageSources,
  }), [existing?.imageSources, pendingImages]);

  useEffect(() => {
    setPendingImages((current) => {
      const next = current.filter((image) => referencedImageIds.has(image.id));
      if (next.length === current.length) return current;
      for (const image of current) {
        if (!referencedImageIds.has(image.id)) URL.revokeObjectURL(image.previewUrl);
      }
      return next;
    });
  }, [referencedImageIds]);

  useEffect(() => {
    if (!existing) return;
    if (activeId.current === existing.id) return;
    const draft = readRecovery(creatorEmail ?? null, existing.id);
    const nextMarkdown = draft.markdown && draft.publishedId === existing.id ? draft.markdown : existing.markdown;
    activeId.current = existing.id;
    setPublishedId(existing.id);
    setPublishedMarkdown(existing.markdown);
    setMarkdown(nextMarkdown);
    setExpiresAt(existing.expiresAt ?? null);
    setPendingImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setRecoveredDraft(nextMarkdown !== existing.markdown);
  }, [creatorEmail, existing]);

  useEffect(() => {
    persistRecovery(creatorEmail ?? null, publishedId, { markdown, publishedMarkdown, publishedId });
  }, [creatorEmail, markdown, publishedId, publishedMarkdown]);

  useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(false), 1900);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  useEffect(() => {
    if (!recoveredDraft) return;
    const timeout = window.setTimeout(() => setRecoveredDraft(false), 1900);
    return () => window.clearTimeout(timeout);
  }, [recoveredDraft]);

  const save = useCallback(async (options?: { expiresAt?: Date | null }) => {
    setIsSaving(true);
    setSaveError(null);
    const nextExpiry = options && 'expiresAt' in options ? options.expiresAt ?? null : expiresAt;
    try {
      const images = pendingImages
        .filter((image): image is PendingImage & { file: File } => (
          !image.uploaded && Boolean(image.file) && referencedImageIds.has(image.id)
        ))
        .map((image) => ({ id: image.id, file: image.file }));
      const outcome = await lifecycle.save(markdown, handle, {
        expiresAt: nextExpiry,
        ...(images.length ? { images } : {}),
      }, ownerUserId);
      if (outcome.kind === 'published') {
        activeId.current = outcome.document.id;
        setPublishedMarkdown(outcome.document.markdown);
        setPublishedId(outcome.document.id);
        setExpiresAt(outcome.document.expiresAt ?? nextExpiry);
        setRecoveredDraft(false);
        setSavedNotice(true);
        setPendingImages((current) => current.map((image) => (
          referencedImageIds.has(image.id) ? { id: image.id, previewUrl: image.previewUrl, uploaded: true } : image
        )));
        if (!handle) persistRecovery(creatorEmail ?? null, null, emptyRecovery);
      } else if (outcome.kind === 'not-configured') {
        setSaveError('Saving needs an InstantDB app. Add VITE_INSTANT_APP_ID to save this document.');
      } else if (outcome.kind === 'forbidden') {
        setSaveError('You need an invitation to save documents.');
      } else if (outcome.kind === 'rate-limited') {
        setSaveError(outcome.limit === 'create'
          ? 'This signed-in creator has created too many documents in the last hour. Please try again later.'
          : 'This signed-in creator has uploaded too many images in the last hour. Please try again later.');
      } else {
        setSaveError('We could not save this document. Please try again.');
      }
      return outcome;
    } catch {
      setSaveError('We could not save this document. Please try again.');
      return { kind: 'failed' } satisfies SaveDocumentOutcome;
    } finally {
      setIsSaving(false);
    }
  }, [creatorEmail, expiresAt, handle, lifecycle, markdown, ownerUserId, pendingImages, referencedImageIds]);

  const deleteDocument = useCallback(async () => {
    if (!handle) return { kind: 'failed' as const };
    setDeleteError(null);
    try {
      const outcome = await lifecycle.delete(handle);
      if (outcome.kind === 'deleted') {
        persistRecovery(creatorEmail ?? null, handle.id, emptyRecovery);
        persistRecovery(creatorEmail ?? null, null, emptyRecovery);
        activeId.current = null;
        setMarkdown('');
        setPublishedMarkdown('');
        setPublishedId(null);
        setExpiresAt(null);
      } else {
        setDeleteError('We could not delete this document. Please try again.');
      }
      return outcome;
    } catch {
      setDeleteError('We could not delete this document. Please try again.');
      return { kind: 'failed' as const };
    }
  }, [creatorEmail, handle, lifecycle]);

  const attachFiles = useCallback((files: File[], insertAt?: { start: number; end: number }): boolean => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return false;

    let nextCount = imageCount;
    const attached: PendingImage[] = [];
    const snippets: string[] = [];
    for (const file of images) {
      const outcome = lifecycle.attachImage(file, nextCount);
      if (outcome.kind !== 'attached') {
        setImageError(
          outcome.kind === 'too-large' ? IMAGE_TOO_LARGE_MESSAGE
            : outcome.kind === 'too-many' ? imageTooManyMessage()
              : 'MarkShare can paste PNG, JPEG, WebP, and GIF images.',
        );
        break;
      }
      nextCount += 1;
      snippets.push(outcome.image.markdown);
      attached.push({
        id: outcome.image.id,
        file,
        previewUrl: URL.createObjectURL(file),
        uploaded: false,
      });
    }
    if (!attached.length) return false;
    setPendingImages((current) => [...current, ...attached]);
    const snippet = snippets.join('\n\n');
    setMarkdown((current) => insertSnippet(current, snippet, insertAt?.start ?? current.length, insertAt?.end ?? insertAt?.start ?? current.length));
    return true;
  }, [imageCount, lifecycle]);

  const importMarkdown = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setMarkdown(await file.text());
      setRecoveredDraft(false);
    } catch {
      setImportError('We could not import that Markdown file. Please try again.');
    }
  }, []);

  return {
    markdown,
    setMarkdown,
    publishedId,
    expiresAt,
    imageCount,
    imageSources,
    hasUnsavedChanges,
    isSaving,
    saveError,
    importError,
    imageError,
    deleteError,
    recoveredDraft,
    savedNotice,
    dismissRecoveredDraft: () => setRecoveredDraft(false),
    dismissSaveError: () => setSaveError(null),
    dismissImportError: () => setImportError(null),
    dismissImageError: () => setImageError(null),
    dismissDeleteError: () => setDeleteError(null),
    save,
    deleteDocument,
    attachFiles,
    importMarkdown,
  };
}

export function useEditorSplit() {
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applySplit = useCallback((next: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(next)));
    panesRef.current?.style.setProperty('--split', `${clamped}%`);
    return clamped;
  }, []);

  const finishDrag = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    window.document.body.classList.remove('is-resizing');
    const value = panesRef.current?.style.getPropertyValue('--split');
    setSplit(Number.parseFloat(value ?? '') || DEFAULT_SPLIT);
  }, []);

  useEffect(() => () => window.document.body.classList.remove('is-resizing'), []);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    window.document.body.classList.add('is-resizing');
  }, []);

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || !panesRef.current) return;
    const rect = panesRef.current.getBoundingClientRect();
    if (rect.width) applySplit(((event.clientX - rect.left) / rect.width) * 100);
  }, [applySplit]);

  const resetSplit = useCallback(() => {
    applySplit(DEFAULT_SPLIT);
    setSplit(DEFAULT_SPLIT);
  }, [applySplit]);

  const resizeByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const amount = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setSplit(applySplit(split - amount)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setSplit(applySplit(split + amount)); }
    if (event.key === 'End') { event.preventDefault(); setSplit(applySplit(MAX_SPLIT)); }
    if (event.key === 'Home') { event.preventDefault(); resetSplit(); }
  }, [applySplit, resetSplit, split]);

  return { panesRef, split, startDrag, moveDrag, finishDrag, resetSplit, resizeByKeyboard };
}

export { MAX_SPLIT, MIN_SPLIT };
