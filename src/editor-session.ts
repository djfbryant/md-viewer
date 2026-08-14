import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DocumentLifecycle, EditCapability, EditableDocument, SaveDocumentOutcome } from './document-lifecycle';
import { MAX_IMAGES_PER_DOCUMENT } from './document-image';

const RECOVERY_KEY = 'markshare-editor-recovery-v1';
const ACCESS_KEY = 'markshare-edit-access-v1';
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;

type Recovery = {
  markdown: string;
  publishedMarkdown: string;
  publishedId: string | null;
  publishedEditId: string | null;
};

const emptyRecovery: Recovery = { markdown: '', publishedMarkdown: '', publishedId: null, publishedEditId: null };

function recoveryStorageKey(editId: string | null) {
  return editId ? `${RECOVERY_KEY}:${editId}` : RECOVERY_KEY;
}

function readRecovery(editId: string | null = null): Recovery {
  try {
    const raw = window.localStorage.getItem(recoveryStorageKey(editId));
    if (!raw) return emptyRecovery;
    const parsed = JSON.parse(raw) as Partial<Recovery>;
    if (typeof parsed.markdown !== 'string' || typeof parsed.publishedMarkdown !== 'string') return emptyRecovery;
    return {
      markdown: parsed.markdown,
      publishedMarkdown: parsed.publishedMarkdown,
      publishedId: typeof parsed.publishedId === 'string' ? parsed.publishedId : null,
      publishedEditId: typeof parsed.publishedEditId === 'string' ? parsed.publishedEditId : null,
    };
  } catch {
    return emptyRecovery;
  }
}

function persistRecovery(editId: string | null, recovery: Recovery) {
  try {
    const key = recoveryStorageKey(editId);
    if (recovery.markdown === recovery.publishedMarkdown) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(recovery));
    if (key !== RECOVERY_KEY) window.localStorage.removeItem(RECOVERY_KEY);
  } catch {
    // Local recovery is a convenience. A blocked storage area must not prevent editing.
  }
}

function readAccess(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(ACCESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function writeAccess(access: Record<string, string>) {
  try {
    window.localStorage.setItem(ACCESS_KEY, JSON.stringify(access));
  } catch {
    // Remembered edit access is a convenience, not a requirement to edit from an Edit Link.
  }
}

export function rememberEditAccess(id: string, editId: string) {
  const access = readAccess();
  if (access[id] === editId) return;
  writeAccess({ ...access, [id]: editId });
}

export function recallEditAccess(id: string) {
  return readAccess()[id] ?? null;
}

export function forgetEditAccess(id: string) {
  const next = readAccess();
  delete next[id];
  writeAccess(next);
}

function insertSnippet(markdown: string, snippet: string, start: number, end: number) {
  const padBefore = start > 0 && markdown[start - 1] !== '\n' ? '\n\n' : '';
  const padAfter = end < markdown.length && markdown[end] !== '\n' ? '\n\n' : '\n';
  return markdown.slice(0, start) + padBefore + snippet + padAfter + markdown.slice(end);
}

type PendingImage = {
  file: File;
  id: string;
  previewUrl: string;
  uploaded: boolean;
};

export function useEditorSession(
  lifecycle: Pick<DocumentLifecycle, 'attachImage' | 'save' | 'delete' | 'rotate'>,
  existing?: EditableDocument,
  routeEditId?: string,
) {
  const [recovery] = useState(() => readRecovery(existing?.editId ?? routeEditId ?? null));
  const initialMarkdown = recovery.markdown && (!existing || recovery.publishedId === existing.id || recovery.publishedEditId === existing.editId)
    ? recovery.markdown
    : (existing?.markdown ?? recovery.markdown);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [publishedMarkdown, setPublishedMarkdown] = useState(existing?.markdown ?? recovery.publishedMarkdown);
  const [publishedId, setPublishedId] = useState(existing?.id ?? recovery.publishedId);
  const [publishedEditId, setPublishedEditId] = useState(existing?.editId ?? recovery.publishedEditId);
  const [expiresAt, setExpiresAt] = useState<Date | null>(existing?.expiresAt ?? null);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(Boolean(initialMarkdown && initialMarkdown !== (existing?.markdown ?? recovery.publishedMarkdown)));
  const [savedNotice, setSavedNotice] = useState(false);
  const activeEditId = useRef<string | null>(existing?.editId ?? recovery.publishedEditId);
  const pendingImagesRef = useRef<PendingImage[]>([]);
  pendingImagesRef.current = pendingImages;

  useEffect(() => () => {
    pendingImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
  }, []);

  const hasUnsavedChanges = markdown !== publishedMarkdown;
  const capability: EditCapability | undefined = publishedId && publishedEditId
    ? { id: publishedId, editId: publishedEditId }
    : undefined;
  const publishedImageCount = Object.keys(existing?.imageSources ?? {}).length;
  const imageCount = publishedImageCount + pendingImages.filter((image) => !existing?.imageSources?.[image.id]).length;
  const imageSources = useMemo(() => ({
    ...existing?.imageSources,
    ...Object.fromEntries(pendingImages.map((image) => [image.id, image.previewUrl])),
  }), [existing?.imageSources, pendingImages]);

  useEffect(() => {
    if (!existing) return;
    if (activeEditId.current === existing.editId) {
      rememberEditAccess(existing.id, existing.editId);
      return;
    }
    const draft = readRecovery(existing.editId);
    const nextMarkdown = draft.markdown && draft.publishedId === existing.id ? draft.markdown : existing.markdown;
    activeEditId.current = existing.editId;
    setPublishedId(existing.id);
    setPublishedEditId(existing.editId);
    setPublishedMarkdown(existing.markdown);
    setMarkdown(nextMarkdown);
    setExpiresAt(existing.expiresAt ?? null);
    setPendingImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
    setRecoveredDraft(nextMarkdown !== existing.markdown);
    rememberEditAccess(existing.id, existing.editId);
  }, [existing?.editId, existing?.expiresAt, existing?.id, existing?.markdown]);

  useEffect(() => {
    persistRecovery(publishedEditId ?? routeEditId ?? null, { markdown, publishedMarkdown, publishedId, publishedEditId });
  }, [markdown, publishedEditId, publishedId, publishedMarkdown, routeEditId]);

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
      const images = pendingImages.filter((image) => !image.uploaded).map((image) => ({ id: image.id, file: image.file }));
      const outcome = await lifecycle.save(markdown, capability, {
        expiresAt: nextExpiry,
        ...(images.length ? { images } : {}),
      });
      if (outcome.kind === 'published') {
        activeEditId.current = outcome.document.editId;
        setPublishedMarkdown(outcome.document.markdown);
        setPublishedId(outcome.document.id);
        setPublishedEditId(outcome.document.editId);
        setExpiresAt(outcome.document.expiresAt ?? nextExpiry);
        setRecoveredDraft(false);
        setSavedNotice(true);
        rememberEditAccess(outcome.document.id, outcome.document.editId);
        setPendingImages((current) => current.map((image) => ({ ...image, uploaded: true })));
        if (!capability) persistRecovery(null, emptyRecovery);
      } else if (outcome.kind === 'not-configured') {
        setSaveError('Saving needs an InstantDB app. Add VITE_INSTANT_APP_ID to save this document.');
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
  }, [capability, expiresAt, lifecycle, markdown, pendingImages]);

  const deleteDocument = useCallback(async () => {
    if (!capability) return { kind: 'failed' as const };
    setDeleteError(null);
    try {
      const outcome = await lifecycle.delete(capability);
      if (outcome.kind === 'deleted') {
        forgetEditAccess(capability.id);
        persistRecovery(capability.editId, emptyRecovery);
        persistRecovery(null, emptyRecovery);
        activeEditId.current = null;
        setMarkdown('');
        setPublishedMarkdown('');
        setPublishedId(null);
        setPublishedEditId(null);
        setExpiresAt(null);
      } else {
        setDeleteError('We could not delete this document. Please try again.');
      }
      return outcome;
    } catch {
      setDeleteError('We could not delete this document. Please try again.');
      return { kind: 'failed' as const };
    }
  }, [capability, lifecycle]);

  const rotateEditLink = useCallback(async () => {
    if (!capability) return { kind: 'failed' as const };
    setRotateError(null);
    try {
      const outcome = await lifecycle.rotate(capability);
      if (outcome.kind === 'rotated') {
        persistRecovery(capability.editId, emptyRecovery);
        activeEditId.current = outcome.document.editId;
        setPublishedEditId(outcome.document.editId);
        rememberEditAccess(outcome.document.id, outcome.document.editId);
      } else {
        setRotateError('We could not replace this edit link. Please try again.');
      }
      return outcome;
    } catch {
      setRotateError('We could not replace this edit link. Please try again.');
      return { kind: 'failed' as const };
    }
  }, [capability, lifecycle]);

  const attachFiles = useCallback((files: File[], insertAt?: { start: number; end: number }) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;

    let nextCount = imageCount;
    const attached: PendingImage[] = [];
    const snippets: string[] = [];
    for (const file of images) {
      const outcome = lifecycle.attachImage(file, nextCount);
      if (outcome.kind !== 'attached') {
        setImageError(
          outcome.kind === 'too-large' ? 'Each image must be 5 MB or smaller.'
            : outcome.kind === 'too-many' ? `A document can include up to ${MAX_IMAGES_PER_DOCUMENT} images.`
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
    if (!attached.length) return;
    setPendingImages((current) => [...current, ...attached]);
    const snippet = snippets.join('\n\n');
    setMarkdown((current) => insertSnippet(current, snippet, insertAt?.start ?? current.length, insertAt?.end ?? insertAt?.start ?? current.length));
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
    publishedEditId,
    expiresAt,
    imageCount,
    imageSources,
    hasUnsavedChanges,
    isSaving,
    saveError,
    importError,
    imageError,
    deleteError,
    rotateError,
    recoveredDraft,
    savedNotice,
    dismissRecoveredDraft: () => setRecoveredDraft(false),
    dismissSaveError: () => setSaveError(null),
    dismissImportError: () => setImportError(null),
    dismissImageError: () => setImageError(null),
    dismissDeleteError: () => setDeleteError(null),
    dismissRotateError: () => setRotateError(null),
    save,
    deleteDocument,
    rotateEditLink,
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
