import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { DocumentLifecycle, EditCapability, SaveDocumentOutcome } from './document-lifecycle';

const RECOVERY_KEY = 'markshare-editor-recovery-v1';
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;

type Recovery = {
  markdown: string;
  publishedMarkdown: string;
  publishedId: string | null;
  publishedEditId: string | null;
};

function readRecovery(): Recovery {
  try {
    const raw = window.localStorage.getItem(RECOVERY_KEY);
    if (!raw) return { markdown: '', publishedMarkdown: '', publishedId: null, publishedEditId: null };
    const parsed = JSON.parse(raw) as Partial<Recovery>;
    if (typeof parsed.markdown !== 'string' || typeof parsed.publishedMarkdown !== 'string') {
      return { markdown: '', publishedMarkdown: '', publishedId: null, publishedEditId: null };
    }
    return {
      markdown: parsed.markdown,
      publishedMarkdown: parsed.publishedMarkdown,
      publishedId: typeof parsed.publishedId === 'string' ? parsed.publishedId : null,
      publishedEditId: typeof parsed.publishedEditId === 'string' ? parsed.publishedEditId : null,
    };
  } catch {
    return { markdown: '', publishedMarkdown: '', publishedId: null, publishedEditId: null };
  }
}

function persistRecovery(recovery: Recovery) {
  try {
    if (recovery.markdown === recovery.publishedMarkdown) {
      window.localStorage.removeItem(RECOVERY_KEY);
      return;
    }
    window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
  } catch {
    // Local recovery is a convenience. A blocked storage area must not prevent editing.
  }
}

export function useEditorSession(lifecycle: Pick<DocumentLifecycle, 'save' | 'delete'>) {
  const [recovery] = useState(readRecovery);
  const [markdown, setMarkdown] = useState(recovery.markdown);
  const [publishedMarkdown, setPublishedMarkdown] = useState(recovery.publishedMarkdown);
  const [publishedId, setPublishedId] = useState(recovery.publishedId);
  const [publishedEditId, setPublishedEditId] = useState(recovery.publishedEditId);
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(Boolean(recovery.markdown && recovery.markdown !== recovery.publishedMarkdown));
  const [savedNotice, setSavedNotice] = useState(false);

  const hasUnsavedChanges = markdown !== publishedMarkdown;
  const capability: EditCapability | undefined = publishedId && publishedEditId
    ? { id: publishedId, editId: publishedEditId }
    : undefined;

  useEffect(() => {
    persistRecovery({ markdown, publishedMarkdown, publishedId, publishedEditId });
  }, [markdown, publishedEditId, publishedId, publishedMarkdown]);

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
      const outcome = await lifecycle.save(markdown, capability, { expiresAt: nextExpiry });
      if (outcome.kind === 'published') {
        setPublishedMarkdown(outcome.document.markdown);
        setPublishedId(outcome.document.id);
        setPublishedEditId(outcome.document.editId);
        setExpiresAt(outcome.document.expiresAt ?? nextExpiry);
        setRecoveredDraft(false);
        setSavedNotice(true);
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
  }, [capability, expiresAt, lifecycle, markdown]);

  const deleteDocument = useCallback(async () => {
    if (!capability) return { kind: 'failed' as const };
    setDeleteError(null);
    try {
      const outcome = await lifecycle.delete(capability);
      if (outcome.kind === 'deleted') {
        setMarkdown('');
        setPublishedMarkdown('');
        setPublishedId(null);
        setPublishedEditId(null);
        setExpiresAt(null);
        persistRecovery({ markdown: '', publishedMarkdown: '', publishedId: null, publishedEditId: null });
      } else {
        setDeleteError('We could not delete this document. Please try again.');
      }
      return outcome;
    } catch {
      setDeleteError('We could not delete this document. Please try again.');
      return { kind: 'failed' as const };
    }
  }, [capability, lifecycle]);

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
    hasUnsavedChanges,
    isSaving,
    saveError,
    importError,
    deleteError,
    recoveredDraft,
    savedNotice,
    dismissRecoveredDraft: () => setRecoveredDraft(false),
    dismissSaveError: () => setSaveError(null),
    dismissImportError: () => setImportError(null),
    dismissDeleteError: () => setDeleteError(null),
    save,
    deleteDocument,
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
