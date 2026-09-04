import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type FocusEvent, type MouseEvent } from 'react';
import { ClubProvider, sendMagicCode, signInWithMagicCode, signOutClub, useClubSession, type ClubSession } from './club-auth';
import { formatExpiry, toDatetimeLocalValue } from './document';
import { DocumentLifecycleProvider, useDocumentLifecycle, type DocumentLifecycle, type SharedDocument } from './document-lifecycle';
import { MAX_IMAGES_PER_DOCUMENT } from './document-image';
import { copyToClipboard } from './clipboard';
import { MAX_SPLIT, MIN_SPLIT, useEditorSession, useEditorSplit } from './editor-session';
import { findSourceBlockAtOffset, scrollSourceBlockIntoView, sourceOffsetForEditorOffset, sourceOffsetFromPreviewTarget } from './editor-position-sync';
import { documentLifecycle } from './lib/instant-document-persistence';
import { downloadMarkdown, interpretMarkdown, MarkdownView, type InterpretedMarkdown, type MermaidExpandRequest } from './markdown';
import { MermaidViewer } from './mermaid-viewer';
import { EDITOR_PATH, SIGN_IN_PATH, documentPath, infoPath, onPathChange, privacyFor, pushPath, recognizeRoute, replacePath, sharePath, shareUrl, type InfoPage, type RoutePrivacy } from './navigation';
import { infoCopy, infoNav } from './public-information';
import { ThemeButton, ThemeProvider } from './theme-control';

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  const selector = `meta[${attribute}="${key}"]`;
  let element = window.document.head.querySelector(selector);
  if (!element) {
    element = window.document.createElement('meta');
    element.setAttribute(attribute, key);
    window.document.head.append(element);
  }
  element.setAttribute('content', content);
}

function applyRoutePrivacy(privacy: RoutePrivacy) {
  window.document.title = privacy.pageTitle;
  upsertMeta('name', 'robots', privacy.robots);
  upsertMeta('name', 'referrer', privacy.referrer);
  upsertMeta('property', 'og:title', privacy.previewTitle);
  upsertMeta('property', 'og:description', privacy.previewDescription);
  upsertMeta('name', 'twitter:title', privacy.previewTitle);
  upsertMeta('name', 'twitter:description', privacy.previewDescription);
}

function Brand({ showName = true }: { showName?: boolean }) {
  return <div className="brand"><span className="mark" aria-hidden="true" />{showName && <span className="brand-name">MarkShare</span>}</div>;
}

function SiteLinks({ current, onNavigate }: { current?: InfoPage; onNavigate: (path: string) => void }) {
  return (
    <nav className="site-links" aria-label="About MarkShare">
      {infoNav.map(({ page, label }) => (
        <a
          key={page}
          href={infoPath[page]}
          aria-current={current === page ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            onNavigate(infoPath[page]);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function LinkBox({ label, value, className = 'link-box' }: { label: string; value: string; className?: string }) {
  const selectValue = (event: FocusEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };
  return (
    <input
      className={className}
      readOnly
      value={value}
      aria-label={label}
      onFocus={selectValue}
      onClick={selectValue}
    />
  );
}

function CopyableLink({ copyLabel, label, onCopy, value }: { copyLabel: string; label: string; onCopy: (value: string) => void; value: string }) {
  return (
    <div className="dialog-row">
      <LinkBox label={label} value={value} />
      <button className="button button--small" aria-label={copyLabel} onClick={() => onCopy(value)}>Copy</button>
    </div>
  );
}

function AuthActions({ onNavigate }: { onNavigate: (path: string) => void }) {
  const club = useClubSession();
  if (club.status === 'signed-in') {
    return (
      <div className="auth-actions">
        <span className="auth-email">{club.user.email}</span>
        <button className="button button--small" onClick={() => { void signOutClub(); onNavigate('/'); }}>Sign out</button>
      </div>
    );
  }
  return <button className="button" onClick={() => onNavigate(SIGN_IN_PATH)}>Sign in</button>;
}

function RenderedDocument({ document, imageSources }: { document: InterpretedMarkdown; imageSources?: Record<string, string> }) {
  const [expandedMermaid, setExpandedMermaid] = useState<MermaidExpandRequest | null>(null);

  return <>
    <MarkdownView
      document={document}
      imageSources={imageSources}
      openMermaidId={expandedMermaid?.id}
      onMermaidExpand={setExpandedMermaid}
    />
    {expandedMermaid && <MermaidViewer
      open
      svg={expandedMermaid.svg}
      returnFocusRef={expandedMermaid.returnFocusRef}
      onClose={() => setExpandedMermaid(null)}
    />}
  </>;
}

function Home({ onCreate, onNavigate }: { onCreate: () => void; onNavigate: (path: string) => void }) {
  const club = useClubSession();
  const lifecycle = useDocumentLifecycle();
  const userId = club.status === 'signed-in' ? club.user.id : null;
  const library = lifecycle.useCreatorLibrary(userId);

  return (
    <main className="home-shell">
      <header className="app-bar home-bar">
        <Brand />
        <div className="bar-actions">
          <SiteLinks onNavigate={onNavigate} />
          <ThemeButton />
          <AuthActions onNavigate={onNavigate} />
        </div>
      </header>
      {club.status === 'signed-in' && club.isCreator ? (
        <section className="home-content home-content--club" aria-labelledby="home-title">
          <div className="home-copy">
            <p className="eyebrow">Writing club</p>
            <h1 id="home-title">Your documents</h1>
            <button className="button button--primary create-button" onClick={onCreate}>Create a document <span aria-hidden="true">→</span></button>
          </div>
          <div className="document-lists">
            <section aria-labelledby="owned-heading">
              <h2 id="owned-heading">Owned</h2>
              {library.owned.length ? (
                <ul className="document-list">
                  {library.owned.map((document) => (
                    <li key={document.id}>
                      <button className="document-list-link" onClick={() => onNavigate(documentPath(document.id))}>{document.title}</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="home-note">None yet.</p>}
            </section>
            <section aria-labelledby="granted-heading">
              <h2 id="granted-heading">Granted to you</h2>
              {library.granted.length ? (
                <ul className="document-list">
                  {library.granted.map((document) => (
                    <li key={document.id}>
                      <button className="document-list-link" onClick={() => onNavigate(documentPath(document.id))}>{document.title}</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="home-note">None yet.</p>}
            </section>
          </div>
        </section>
      ) : (
        <section className="home-content" aria-labelledby="home-title">
          <div className="home-copy">
            <p className="eyebrow">Markdown, quietly shared</p>
            <h1 id="home-title">Write clearly.<br />Share simply.</h1>
            <p className="home-description">Invited creators write Markdown. Anyone with a share link can read it.</p>
            {club.status === 'signed-in' ? (
              <p className="home-note">You are not invited.</p>
            ) : (
              <button className="button button--primary create-button" onClick={() => onNavigate(SIGN_IN_PATH)}>Sign in <span aria-hidden="true">→</span></button>
            )}
          </div>
          <aside className="home-card" aria-label="How MarkShare works">
            <div className="card-step"><span>01</span><div><strong>Sign in</strong><p>Creators are invited. They open a code sent to their email.</p></div></div>
            <div className="card-step"><span>02</span><div><strong>Write</strong><p>Use familiar Markdown in a focused workspace.</p></div></div>
            <div className="card-step"><span>03</span><div><strong>Send one link</strong><p>Readers get a clean, read-only document.</p></div></div>
          </aside>
        </section>
      )}
      <footer className="home-footer">
        <span className="home-tagline">Invite only · Share links are read only</span>
        <SiteLinks onNavigate={onNavigate} />
      </footer>
    </main>
  );
}

function SignIn({ onHome, onNavigate }: { onHome: () => void; onNavigate: (path: string) => void }) {
  const club = useClubSession();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentEmail, setSentEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (club.status === 'signed-in') onHome();
  }, [club, onHome]);

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendMagicCode(email);
      setSentEmail(email.trim().toLowerCase());
    } catch {
      setError('We could not send a code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithMagicCode(sentEmail, code);
    } catch {
      setError('That code did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="info-shell">
      <header className="app-bar">
        <button className="brand brand-button" onClick={onHome} aria-label="Back to MarkShare home"><Brand /></button>
        <div className="bar-actions">
          <SiteLinks onNavigate={onNavigate} />
          <ThemeButton />
        </div>
      </header>
      <article className="info-content" aria-labelledby="sign-in-title">
        <div className="info-article">
          <p className="eyebrow">Creators</p>
          <h1 id="sign-in-title">Sign in</h1>
          {!sentEmail ? (
            <form className="auth-form" onSubmit={(event) => { void sendCode(event); }}>
              <label>
                <span className="label">Email</span>
                <input type="email" autoComplete="email" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
            </form>
          ) : (
            <form className="auth-form" onSubmit={(event) => { void verify(event); }}>
              <p>Enter the code sent to your email.</p>
              <label>
                <span className="label">Code</span>
                <input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(event) => setCode(event.target.value)} />
              </label>
              {error && <p className="auth-error">{error}</p>}
              <button className="button button--primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
            </form>
          )}
        </div>
      </article>
    </main>
  );
}

function Info({
  page,
  onHome,
  onNavigate,
}: {
  page: InfoPage;
  onHome: () => void;
  onNavigate: (path: string) => void;
}) {
  const copy = infoCopy[page];

  return (
    <main className="info-shell">
      <header className="app-bar">
        <button className="brand brand-button" onClick={onHome} aria-label="Back to MarkShare home"><Brand /></button>
        <div className="bar-actions">
          <SiteLinks current={page} onNavigate={onNavigate} />
          <ThemeButton />
          <AuthActions onNavigate={onNavigate} />
        </div>
      </header>
      <article className="info-content" aria-labelledby="info-title">
        <div className="info-article">
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1 id="info-title">{copy.title}</h1>
          <p className="info-lead">{copy.lead}</p>
          {copy.sections.map((section) => (
            <section key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          ))}
          <p className="info-updated">Last updated {copy.updated}</p>
        </div>
      </article>
    </main>
  );
}

function Editor({
  onBack,
  onNavigate,
  onReplace,
  documentId,
}: {
  onBack: () => void;
  onNavigate: (path: string) => void;
  onReplace: (path: string) => void;
  documentId?: string;
}) {
  const club = useClubSession();
  const lifecycle = useDocumentLifecycle();
  const userId = club.status === 'signed-in' ? club.user.id : null;
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [syncPosition, setSyncPosition] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ id: number; message: string } | null>(null);
  const [grantEmail, setGrantEmail] = useState('');
  const [grantError, setGrantError] = useState<string | null>(null);
  const remote = lifecycle.useEditDocument(documentId ?? '', userId);
  const existing = documentId && remote.kind === 'available' ? remote.document : undefined;
  const session = useEditorSession(
    lifecycle,
    existing,
    club.status === 'signed-in' ? club.user.email : null,
    club.status === 'signed-in' ? club.user.id : undefined,
  );
  const split = useEditorSplit();
  const { markdown, isSaving, save, imageCount, imageSources, attachFiles } = session;
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pendingEditorOffset = useRef<number | null>(null);
  const pendingMobileFocusOffset = useRef<number | null>(null);
  const interpreted = useMemo(
    () => interpretMarkdown(markdown, { includeSourcePositions: syncPosition }),
    [markdown, syncPosition],
  );
  const isOwner = !documentId || existing?.role === 'owner';

  const scrollPreviewToOffset = useCallback((offset: number) => {
    const preview = previewRef.current;
    if (!preview) return;
    scrollSourceBlockIntoView(findSourceBlockAtOffset(preview, offset));
  }, []);

  const syncPreviewToEditor = useCallback((editor: HTMLTextAreaElement, deferUntilRender = false, offsetOverride?: number) => {
    if (!syncPosition) return;
    const offset = offsetOverride ?? editor.selectionStart;
    pendingEditorOffset.current = deferUntilRender ? offset : null;
    scrollPreviewToOffset(offset);
  }, [scrollPreviewToOffset, syncPosition]);

  useLayoutEffect(() => {
    if (!syncPosition) {
      pendingEditorOffset.current = null;
      return;
    }
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const offset = pendingEditorOffset.current ?? editor.selectionStart;
    pendingEditorOffset.current = null;
    scrollPreviewToOffset(offset);
  }, [interpreted, scrollPreviewToOffset, syncPosition, tab]);

  useLayoutEffect(() => {
    if (tab !== 'write') return;
    const offset = pendingMobileFocusOffset.current;
    const editor = editorRef.current;
    if (offset === null || !editor) return;
    pendingMobileFocusOffset.current = null;
    editor.focus();
    editor.setSelectionRange(offset, offset);
  }, [tab]);

  const focusEditorAtSourceOffset = useCallback((offset: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    if (window.matchMedia('(max-width: 899px)').matches && tab !== 'write') {
      pendingMobileFocusOffset.current = offset;
      setTab('write');
      return;
    }
    editor.focus();
    editor.setSelectionRange(offset, offset);
  }, [tab]);

  const handlePreviewClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!syncPosition) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('a, button, input, select, textarea')) return;
    const offset = sourceOffsetFromPreviewTarget(event.currentTarget, event.target);
    if (offset === null) return;
    focusEditorAtSourceOffset(offset);
  }, [focusEditorAtSourceOffset, syncPosition]);

  const insertFiles = useCallback((files: File[], target: HTMLTextAreaElement) => {
    const editorStart = target.selectionStart;
    const editorEnd = target.selectionEnd;
    const normalizedMarkdown = markdown.replace(/\r\n?/g, '\n');
    const insertedBlockOffset = editorStart > 0 && normalizedMarkdown[editorStart - 1] !== '\n' ? editorStart + 2 : editorStart;
    const attached = attachFiles(files, {
      start: sourceOffsetForEditorOffset(markdown, editorStart),
      end: sourceOffsetForEditorOffset(markdown, editorEnd),
    });
    if (attached) syncPreviewToEditor(target, true, insertedBlockOffset);
  }, [attachFiles, markdown, syncPreviewToEditor]);

  const publish = useCallback(async (options?: { expiresAt?: Date | null }) => {
    const outcome = await save(options);
    if (outcome.kind === 'published' && window.location.pathname === EDITOR_PATH) {
      onReplace(documentPath(outcome.document.id));
    }
    return outcome;
  }, [onReplace, save]);

  const copyLink = useCallback((value: string, confirmation: string) => {
    void copyToClipboard(value).then((copied) => {
      const message = copied ? confirmation : 'Could not copy. Select the link and copy it.';
      setCopyNotice((current) => ({ id: (current?.id ?? 0) + 1, message }));
    });
  }, []);

  useEffect(() => {
    if (!copyNotice) return;
    const timeout = window.setTimeout(() => setCopyNotice(null), 1900);
    return () => window.clearTimeout(timeout);
  }, [copyNotice]);

  useEffect(() => {
    const saveWithShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (!isSaving) void publish();
      }
    };
    window.addEventListener('keydown', saveWithShortcut);
    return () => window.removeEventListener('keydown', saveWithShortcut);
  }, [isSaving, publish]);

  if (club.status !== 'signed-in') {
    return <SignIn onHome={onBack} onNavigate={onNavigate} />;
  }
  if (!club.isCreator) {
    return <Home onCreate={() => onNavigate(EDITOR_PATH)} onNavigate={onNavigate} />;
  }
  if (documentId && session.publishedId !== documentId) {
    if (remote.kind === 'unavailable') return <MissingDocument />;
    return <ReaderLayout><section className="reader-message"><p>Opening document…</p></section></ReaderLayout>;
  }

  return (
    <main className="editor-shell" data-tab={tab}>
      <header className="app-bar">
        <button className="brand brand-button" onClick={onBack} aria-label="Back to MarkShare home"><Brand /></button>
        <div className="document-title">
          <span>{markdown.trim() ? interpreted.title : 'New document'}</span>
          <span className={`pill ${session.hasUnsavedChanges ? 'pill--unsaved' : 'pill--saved'}`}>
            {session.hasUnsavedChanges && <span className="dot" aria-hidden="true" />}
            <span className="pill-text">{session.hasUnsavedChanges ? 'Unsaved changes' : 'Saved'}</span>
          </span>
        </div>
        <div className="bar-actions">
          <ThemeButton />
          <AuthActions onNavigate={onNavigate} />
          <label className="button import-button"><span>Import .md</span><input type="file" accept=".md,text/markdown,text/plain" onChange={session.importMarkdown} /></label>
          {session.publishedId && <button className="button share-button" onClick={() => setShareOpen(true)} aria-label="Share"><span className="share-long">Share</span><span className="share-short" aria-hidden="true">↗</span></button>}
          <button className="button button--primary" onClick={() => void publish()} disabled={isSaving}><span className="save-long">{isSaving ? 'Saving…' : 'Save changes'}</span><span className="save-short">Save</span></button>
        </div>
      </header>
      <nav className="tabs" aria-label="Document workspace">
        <div className="segmented-control">
          <button className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Edit</button>
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
        </div>
      </nav>
      <div className="panes" ref={split.panesRef} style={{ '--split': `${split.split}%` } as React.CSSProperties}>
        <section className="pane pane-write" aria-label="Markdown editor">
          <div className="pane-head">
            <span className="label">Write</span>
            <label className="sync-toggle">
              <input
                type="checkbox"
                aria-label="Sync position"
                checked={syncPosition}
                onChange={(event) => setSyncPosition(event.target.checked)}
              />
              <span>Sync position</span>
            </label>
          </div>
          <textarea
            ref={editorRef}
            aria-label="Markdown document"
            placeholder="# Start writing"
            spellCheck={false}
            value={markdown}
            onChange={(event) => {
              session.setMarkdown(event.target.value);
              syncPreviewToEditor(event.currentTarget, true);
            }}
            onSelect={(event) => syncPreviewToEditor(event.currentTarget)}
            onClick={(event) => syncPreviewToEditor(event.currentTarget)}
            onKeyUp={(event) => syncPreviewToEditor(event.currentTarget)}
            onPaste={(event) => {
              const files = [...(event.clipboardData?.files ?? [])];
              if (!files.some((file) => file.type.startsWith('image/'))) return;
              event.preventDefault();
              insertFiles(files, event.currentTarget);
            }}
            onDragOver={(event) => {
              if ([...event.dataTransfer.types].includes('Files')) event.preventDefault();
            }}
            onDrop={(event) => {
              const files = [...event.dataTransfer.files];
              if (!files.some((file) => file.type.startsWith('image/'))) return;
              event.preventDefault();
              insertFiles(files, event.currentTarget);
            }}
          />
        </section>
        <button className="splitter" onPointerDown={split.startDrag} onPointerMove={split.moveDrag} onPointerUp={split.finishDrag} onPointerCancel={split.finishDrag} onLostPointerCapture={split.finishDrag} onDoubleClick={split.resetSplit} onKeyDown={split.resizeByKeyboard} role="separator" aria-orientation="vertical" aria-label="Resize the write and preview panes" aria-valuenow={Math.round(split.split)} aria-valuemin={MIN_SPLIT} aria-valuemax={MAX_SPLIT} title="Drag to resize · double-click to reset" />
        <section className="pane pane-preview" aria-label="Document preview">
          <div className="pane-head"><span className="label">Preview</span><span className="preview-note">{session.hasUnsavedChanges ? 'not yet published' : 'matches share link'}</span></div>
          <div className="preview" ref={previewRef} onClick={handlePreviewClick}><article className={markdown ? 'markdown' : 'preview-placeholder'}>{markdown ? <RenderedDocument document={interpreted} imageSources={imageSources} /> : <><h1>Your preview will appear here</h1><p>Write Markdown, then save a read-only share link.</p></>}</article></div>
        </section>
      </div>
      <footer className="status-footer">
        <span>{markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : 'Draft document'}</span>
        <span>{imageCount}/{MAX_IMAGES_PER_DOCUMENT} images · kept 7 days</span>
        <span>{formatExpiry(session.expiresAt)}</span>
        {session.publishedId
          ? <LinkBox className="status-url" label="Share URL" value={shareUrl(session.publishedId)} />
          : <span className="status-url">Save to create a share link</span>}
      </footer>
      {copyNotice && <div className="toast toast--over-dialog" role="status">{copyNotice.message}</div>}
      {!copyNotice && session.recoveredDraft && <div className="toast" role="status">Recovered unsaved local draft.<button className="toast-dismiss" onClick={session.dismissRecoveredDraft} aria-label="Dismiss recovery message">×</button></div>}
      {session.saveError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="save-error-title" onKeyDown={(event) => { if (event.key === 'Escape') session.dismissSaveError(); }}><h2 id="save-error-title">Document not saved</h2><p>{session.saveError}</p><button autoFocus className="button button--primary" onClick={session.dismissSaveError}>Done</button></section></div>}
      {session.importError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="import-error-title" onKeyDown={(event) => { if (event.key === 'Escape') session.dismissImportError(); }}><h2 id="import-error-title">Markdown not imported</h2><p>{session.importError}</p><button autoFocus className="button button--primary" onClick={session.dismissImportError}>Done</button></section></div>}
      {session.imageError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="image-error-title" onKeyDown={(event) => { if (event.key === 'Escape') session.dismissImageError(); }}><h2 id="image-error-title">Image not added</h2><p>{session.imageError}</p><button autoFocus className="button button--primary" onClick={session.dismissImageError}>Done</button></section></div>}
      {session.deleteError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="delete-error-title" onKeyDown={(event) => { if (event.key === 'Escape') session.dismissDeleteError(); }}><h2 id="delete-error-title">Document not deleted</h2><p>{session.deleteError}</p><button autoFocus className="button button--primary" onClick={session.dismissDeleteError}>Done</button></section></div>}
      {!copyNotice && session.savedNotice && session.publishedId && <div className="toast" role="status">Changes saved. <button className="toast-link" onClick={() => onNavigate(sharePath(session.publishedId!))}>Open share link</button></div>}
      {shareOpen && !confirmDelete && session.publishedId && <div className="dialog-backdrop" role="presentation" onClick={() => { setShareOpen(false); setConfirmDelete(false); }}>
        <section className="dialog" role="dialog" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { setShareOpen(false); setConfirmDelete(false); } }}>
          <h2 id="share-title">Your document is live</h2>
          <p>Anyone with the share link can read it. No one can change it unless you grant them. Pasted images are kept for 7 days, then become placeholder text.</p>
          <div className="dialog-field">
            <span className="label">Share link — read only</span>
            <CopyableLink
              label="Share link — read only"
              copyLabel="Copy share link"
              value={shareUrl(session.publishedId)}
              onCopy={(value) => copyLink(value, 'Share link copied')}
            />
          </div>
          {isOwner && (
            <div className="dialog-field">
              <span className="label">Editors</span>
              {(existing?.editors ?? []).map((editor) => (
                <div className="dialog-row" key={editor.userId}>
                  <span>{editor.email}</span>
                  <button className="button button--small" onClick={() => { void lifecycle.revokeEditor({ id: session.publishedId! }, editor.userId); }}>Remove</button>
                </div>
              ))}
              <form className="dialog-row" onSubmit={(event) => {
                event.preventDefault();
                setGrantError(null);
                 void lifecycle.grantEditor({ id: session.publishedId! }, grantEmail).then((outcome) => {
                  if (outcome.kind === 'granted') setGrantEmail('');
                  else setGrantError('That person needs to be an invited creator who has already signed in.');
                });
              }}>
                <input type="email" aria-label="Editor email" placeholder="creator@example.com" value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} />
                <button className="button button--small" type="submit">Grant</button>
              </form>
              {grantError && <p className="dialog-help">{grantError}</p>}
            </div>
          )}
          {isOwner && (
            <div className="dialog-field">
              <span className="label">Expiry</span>
              <p className="dialog-help">{formatExpiry(session.expiresAt)}</p>
              <div className="dialog-row">
                <input
                  type="datetime-local"
                  aria-label="Expiry date and time"
                  value={session.expiresAt ? toDatetimeLocalValue(session.expiresAt) : ''}
                  onChange={(event) => { void publish({ expiresAt: event.target.value ? new Date(event.target.value) : null }); }}
                />
                {session.expiresAt && <button className="button button--small" onClick={() => void publish({ expiresAt: null })}>Remove</button>}
              </div>
            </div>
          )}
          <div className="dialog-actions dialog-actions--split">
            {isOwner && <button className="button button--quiet button--danger" onClick={() => setConfirmDelete(true)}>Delete document</button>}
            <button className="button button--primary" onClick={() => { setShareOpen(false); setConfirmDelete(false); }}>Done</button>
          </div>
        </section>
      </div>}
      {confirmDelete && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="delete-title" onKeyDown={(event) => { if (event.key === 'Escape') setConfirmDelete(false); }}>
        <h2 id="delete-title">Delete this document?</h2>
        <p>The share link will become unavailable immediately. The document and its images are removed by the daily cleanup.</p>
        <div className="dialog-actions">
          <button className="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
          <button autoFocus className="button button--danger" onClick={() => { void session.deleteDocument().then((outcome) => { if (outcome.kind === 'deleted') { setConfirmDelete(false); setShareOpen(false); onBack(); } }); }}>Delete document</button>
        </div>
      </section></div>}
    </main>
  );
}

function ReaderLayout({ actions, children, title }: { actions?: React.ReactNode; children: React.ReactNode; title?: string }) {
  return <main className="reader-shell">
    <header className="app-bar reader-bar"><Brand />{title && <div className="document-title"><span>{title}</span><span className="pill">Read only</span></div>}<div className="bar-actions">{actions}<ThemeButton /></div></header>
    {children}
  </main>;
}

function Reader({ document, onEdit }: { document: SharedDocument; onEdit?: () => void }) {
  const interpreted = useMemo(() => interpretMarkdown(document.markdown), [document.markdown]);

  return <ReaderLayout
    actions={<>
      <span className="reader-expiry">{formatExpiry(document.expiresAt)}</span>
      {onEdit && <button className="button" onClick={onEdit}>Edit</button>}
      <button className="button" onClick={() => downloadMarkdown(interpreted)}>Download .md</button>
    </>}
    title={interpreted.title}
  ><div className="reader-content"><article className="markdown"><RenderedDocument document={interpreted} imageSources={document.imageSources} /></article></div></ReaderLayout>;
}

function MissingDocument() {
  return <ReaderLayout><section className="reader-message"><h1>Document unavailable</h1><p>This share link is invalid or the document is no longer available.</p></section></ReaderLayout>;
}

function ShareRoute({ documentId, onEdit }: { documentId: string; onEdit: (id: string) => void }) {
  const club = useClubSession();
  const lifecycle = useDocumentLifecycle();
  const userId = club.status === 'signed-in' ? club.user.id : null;
  // The lifecycle owns expiry: the outcome flips to unavailable on its own at the date.
  const outcome = lifecycle.useShareDocument(documentId);
  const editable = lifecycle.useEditDocument(documentId, userId);

  if (outcome.kind === 'loading') return <ReaderLayout><section className="reader-message"><p>Opening document…</p></section></ReaderLayout>;
  return outcome.kind === 'available'
    ? <Reader document={outcome.document} onEdit={editable.kind === 'available' ? () => onEdit(documentId) : undefined} />
    : <MissingDocument />;
}

function CurrentRoute() {
  const club = useClubSession();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const route = recognizeRoute(pathname);

  useEffect(() => {
    applyRoutePrivacy(privacyFor(recognizeRoute(pathname), {
      about: infoCopy.about.title,
      privacy: infoCopy.privacy.title,
      'acceptable-use': infoCopy['acceptable-use'].title,
    }));
  }, [pathname]);

  useEffect(() => onPathChange(() => setPathname(window.location.pathname)), []);

  const navigate = useCallback((path: string) => {
    pushPath(path);
    setPathname(path);
  }, []);

  const replace = useCallback((path: string) => {
    replacePath(path);
    setPathname(path);
  }, []);

  if (club.status === 'loading') {
    return <ReaderLayout><section className="reader-message"><p>Opening…</p></section></ReaderLayout>;
  }

  if (route.kind === 'share') {
    return <ShareRoute documentId={route.documentId} onEdit={(id) => navigate(documentPath(id))} />;
  }

  if (route.kind === 'unavailable') return <MissingDocument />;

  if (route.kind === 'info') {
    return (
      <Info
        page={route.page}
        onHome={() => navigate('/')}
        onNavigate={navigate}
      />
    );
  }

  if (route.kind === 'sign-in') {
    return <SignIn onHome={() => navigate('/')} onNavigate={navigate} />;
  }

  if (route.kind === 'editor' || route.kind === 'document') {
    return (
      <Editor
        onBack={() => navigate('/')}
        onNavigate={navigate}
        onReplace={replace}
        documentId={route.kind === 'document' ? route.documentId : undefined}
      />
    );
  }

  return <Home onCreate={() => navigate(EDITOR_PATH)} onNavigate={navigate} />;
}

export function App({ club, lifecycle = documentLifecycle }: { club?: ClubSession; lifecycle?: DocumentLifecycle } = {}) {
  return (
    <ThemeProvider>
      <ClubProvider session={club}>
        <DocumentLifecycleProvider value={lifecycle}>
          <CurrentRoute />
        </DocumentLifecycleProvider>
      </ClubProvider>
    </ThemeProvider>
  );
}
