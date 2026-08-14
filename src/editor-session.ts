import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { PublishDocumentOutcome } from './document-lifecycle';

const RECOVERY_KEY = 'markshare-editor-recovery-v1';
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;

type Recovery = {
  markdown: string;
  publishedMarkdown: string;
  publishedId: string | null;
};

function readRecovery(): Recovery {
  try {
    const raw = window.localStorage.getItem(RECOVERY_KEY);
    if (!raw) return { markdown: '', publishedMarkdown: '', publishedId: null };
    const parsed = JSON.parse(raw) as Partial<Recovery>;
    if (typeof parsed.markdown !== 'string' || typeof parsed.publishedMarkdown !== 'string') {
      return { markdown: '', publishedMarkdown: '', publishedId: null };
    }
    return {
      markdown: parsed.markdown,
      publishedMarkdown: parsed.publishedMarkdown,
      publishedId: typeof parsed.publishedId === 'string' ? parsed.publishedId : null,
    };
  } catch {
    return { markdown: '', publishedMarkdown: '', publishedId: null };
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

export function useEditorSession(publish: (markdown: string) => Promise<PublishDocumentOutcome>) {
  const recovery = useRef(readRecovery()).current;
  const [markdown, setMarkdown] = useState(recovery.markdown);
  const [publishedMarkdown, setPublishedMarkdown] = useState(recovery.publishedMarkdown);
  const [publishedId, setPublishedId] = useState(recovery.publishedId);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState(Boolean(recovery.markdown && recovery.markdown !== recovery.publishedMarkdown));
  const [savedNotice, setSavedNotice] = useState(false);

  const hasUnsavedChanges = markdown !== publishedMarkdown;

  useEffect(() => {
    persistRecovery({ markdown, publishedMarkdown, publishedId });
  }, [markdown, publishedId, publishedMarkdown]);

  useEffect(() => {
    if (!savedNotice) return;
    const timeout = window.setTimeout(() => setSavedNotice(false), 1900);
    return () => window.clearTimeout(timeout);
  }, [savedNotice]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    const outcome = await publish(markdown);
    if (outcome.kind === 'published') {
      setPublishedMarkdown(outcome.document.markdown);
      setPublishedId(outcome.document.id);
      setRecoveredDraft(false);
      setSavedNotice(true);
    } else if (outcome.kind === 'not-configured') {
      setSaveError('Saving needs an InstantDB app. Add VITE_INSTANT_APP_ID to save this document.');
    } else {
      setSaveError('We could not save this document. Please try again.');
    }
    setIsSaving(false);
    return outcome;
  }, [markdown, publish]);

  const importMarkdown = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      setMarkdown(await file.text());
      setRecoveredDraft(false);
    } catch {
      setSaveError('We could not import that Markdown file. Please try again.');
    }
  }, []);

  return {
    markdown,
    setMarkdown,
    publishedId,
    hasUnsavedChanges,
    isSaving,
    saveError,
    recoveredDraft,
    savedNotice,
    dismissRecoveredDraft: () => setRecoveredDraft(false),
    dismissSaveError: () => setSaveError(null),
    save,
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
    if (event.key === 'Home') { event.preventDefault(); resetSplit(); }
  }, [applySplit, resetSplit, split]);

  return { panesRef, split, startDrag, moveDrag, finishDrag, resetSplit, resizeByKeyboard };
}

export { MAX_SPLIT, MIN_SPLIT };
