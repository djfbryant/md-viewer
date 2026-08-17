import { useCallback, useEffect, useMemo, useState, type FocusEvent, type MouseEvent } from 'react';
import { formatExpiry, toDatetimeLocalValue } from './document';
import { type SharedDocument } from './document-lifecycle';
import { MAX_IMAGES_PER_DOCUMENT } from './document-image';
import { copyToClipboard } from './clipboard';
import { MAX_SPLIT, MIN_SPLIT, recallEditAccess, useEditorSession, useEditorSplit } from './editor-session';
import { documentLifecycle } from './lib/instant-document-persistence';
import { downloadMarkdown, interpretMarkdown, MarkdownView, type InterpretedMarkdown, type MermaidExpandRequest } from './markdown';
import { MermaidViewer } from './mermaid-viewer';
import { EDITOR_PATH, editPath, editUrl, infoPath, onPathChange, privacyFor, pushPath, recognizeRoute, replacePath, sharePath, shareUrl, type InfoPage, type RoutePrivacy } from './navigation';
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

/** A link the author can read in full or take in one gesture. CSS truncates the box, never the copied value. */
function CopyableLink({ copyLabel, label, onCopy, value }: { copyLabel: string; label: string; onCopy: (value: string) => void; value: string }) {
  return (
    <div className="dialog-row">
      <LinkBox label={label} value={value} />
      <button className="button button--small" aria-label={copyLabel} onClick={() => onCopy(value)}>Copy</button>
    </div>
  );
}

/** Keeps Preview and Share Link on the same Mermaid presentation and viewer path. */
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
  return (
    <main className="home-shell">
      <header className="app-bar home-bar">
        <Brand />
        <div className="bar-actions">
          <SiteLinks onNavigate={onNavigate} />
          <ThemeButton />
        </div>
      </header>
      <section className="home-content" aria-labelledby="home-title">
        <div className="home-copy">
          <p className="eyebrow">Markdown, quietly shared</p>
          <h1 id="home-title">Write clearly.<br />Share simply.</h1>
          <p className="home-description">A calm space for Markdown documents. Create a draft, then choose exactly when it becomes available.</p>
          <button className="button button--primary create-button" onClick={onCreate}>Create a document <span aria-hidden="true">→</span></button>
          <p className="home-note">No account required.</p>
        </div>
        <aside className="home-card" aria-label="How MarkShare works">
          <div className="card-step"><span>01</span><div><strong>Write</strong><p>Use familiar Markdown in a focused workspace.</p></div></div>
          <div className="card-step"><span>02</span><div><strong>Choose when to share</strong><p>Your draft stays yours until you save it.</p></div></div>
          <div className="card-step"><span>03</span><div><strong>Send one link</strong><p>Readers get a clean, read-only document.</p></div></div>
        </aside>
      </section>
      <footer className="home-footer">
        <span className="home-tagline">Private by default · Built for clear thinking</span>
        <SiteLinks onNavigate={onNavigate} />
      </footer>
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
  editId,
}: {
  onBack: () => void;
  onNavigate: (path: string) => void;
  onReplace: (path: string) => void;
  editId?: string;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [copyNotice, setCopyNotice] = useState<{ id: number; message: string } | null>(null);
  const remote = documentLifecycle.useEditDocument(editId ?? '');
  const existing = editId && remote.kind === 'available' ? remote.document : undefined;
  const session = useEditorSession(documentLifecycle, existing, editId);
  const split = useEditorSplit();
  const { markdown, isSaving, save, imageCount, imageSources, attachFiles } = session;
  const interpreted = useMemo(() => interpretMarkdown(markdown), [markdown]);

  const insertFiles = useCallback((files: File[], target: HTMLTextAreaElement) => {
    attachFiles(files, { start: target.selectionStart, end: target.selectionEnd });
  }, [attachFiles]);

  const publish = useCallback(async (options?: { expiresAt?: Date | null }) => {
    const outcome = await save(options);
    if (outcome.kind === 'published' && window.location.pathname === EDITOR_PATH) {
      onReplace(editPath(outcome.document.editId));
    }
    return outcome;
  }, [onReplace, save]);

  const copyLink = useCallback((value: string, confirmation: string) => {
    void copyToClipboard(value).then((copied) => {
      const message = copied ? confirmation : 'Could not copy. Select the link and copy it.';
      // The clipboard keeps whichever write finished last, so the last answer is the true
      // one. A fresh id also restarts the toast when the same link is copied twice.
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

  if (editId && session.publishedEditId !== editId) {
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
          <div className="pane-head"><span className="label">Write</span></div>
          <textarea
            aria-label="Markdown document"
            placeholder="# Start writing"
            spellCheck={false}
            value={markdown}
            onChange={(event) => session.setMarkdown(event.target.value)}
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
          <div className="preview"><article className={markdown ? 'markdown' : 'preview-placeholder'}>{markdown ? <RenderedDocument document={interpreted} imageSources={imageSources} /> : <><h1>Your preview will appear here</h1><p>Write Markdown, then save a read-only share link.</p></>}</article></div>
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
      {session.rotateError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="rotate-error-title" onKeyDown={(event) => { if (event.key === 'Escape') session.dismissRotateError(); }}><h2 id="rotate-error-title">Edit link not replaced</h2><p>{session.rotateError}</p><button autoFocus className="button button--primary" onClick={session.dismissRotateError}>Done</button></section></div>}
      {!copyNotice && session.savedNotice && session.publishedId && <div className="toast" role="status">Changes saved. <button className="toast-link" onClick={() => onNavigate(sharePath(session.publishedId!))}>Open share link</button></div>}
      {shareOpen && !confirmDelete && !confirmRotate && session.publishedId && session.publishedEditId && <div className="dialog-backdrop" role="presentation" onClick={() => { setShareOpen(false); setConfirmDelete(false); setConfirmRotate(false); }}>
        <section className="dialog" role="dialog" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') { setShareOpen(false); setConfirmDelete(false); setConfirmRotate(false); } }}>
          <h2 id="share-title">Your document is live</h2>
          <p>Anyone with the share link can read it. No one can change it. Pasted images are kept for 7 days, then become placeholder text.</p>
          <div className="dialog-field">
            <span className="label">Share link — read only</span>
            <CopyableLink
              label="Share link — read only"
              copyLabel="Copy share link"
              value={shareUrl(session.publishedId)}
              onCopy={(value) => copyLink(value, 'Share link copied')}
            />
          </div>
          <div className="dialog-field">
            <span className="label">Edit link — private, keep it safe</span>
            <CopyableLink
              label="Edit link — private, keep it safe"
              copyLabel="Copy edit link"
              value={editUrl(session.publishedEditId)}
              onCopy={(value) => copyLink(value, 'Edit link copied — keep it private')}
            />
            <button className="button button--small" onClick={() => setConfirmRotate(true)}>Replace edit link</button>
          </div>
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
          <div className="dialog-actions dialog-actions--split">
            <button className="button button--quiet button--danger" onClick={() => setConfirmDelete(true)}>Delete document</button>
            <button className="button button--primary" onClick={() => { setShareOpen(false); setConfirmDelete(false); setConfirmRotate(false); }}>Done</button>
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
      {confirmRotate && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="rotate-title" onKeyDown={(event) => { if (event.key === 'Escape') setConfirmRotate(false); }}>
        <h2 id="rotate-title">Replace this edit link?</h2>
        <p>The current edit link will stop working. Anyone who has it will lose edit access.</p>
        <div className="dialog-actions">
          <button className="button" onClick={() => setConfirmRotate(false)}>Cancel</button>
          <button autoFocus className="button button--primary" onClick={() => { void session.rotateEditLink().then((outcome) => { if (outcome.kind === 'rotated') { setConfirmRotate(false); onReplace(editPath(outcome.document.editId)); } }); }}>Replace edit link</button>
        </div>
      </section></div>}
    </main>
  );
}

/** Every reader page carries the theme control, so a loading, expired, or broken link is never a locked theme. */
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

function ShareRoute({ documentId, onEdit }: { documentId: string; onEdit: (editId: string) => void }) {
  const [, setTick] = useState(0);
  const outcome = documentLifecycle.useShareDocument(documentId);
  const rememberedEditId = recallEditAccess(documentId);

  useEffect(() => {
    if (outcome.kind !== 'available' || !outcome.document.expiresAt) return;
    const delay = outcome.document.expiresAt.getTime() - Date.now();
    const timeout = window.setTimeout(
      () => setTick((tick) => tick + 1),
      Math.min(Math.max(0, delay), 2_147_483_647),
    );
    return () => window.clearTimeout(timeout);
  }, [outcome]);

  if (outcome.kind === 'loading') return <ReaderLayout><section className="reader-message"><p>Opening document…</p></section></ReaderLayout>;
  return outcome.kind === 'available'
    ? <Reader document={outcome.document} onEdit={rememberedEditId ? () => onEdit(rememberedEditId) : undefined} />
    : <MissingDocument />;
}

function CurrentRoute() {
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

  if (route.kind === 'share') {
    return <ShareRoute documentId={route.documentId} onEdit={(editId) => navigate(editPath(editId))} />;
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

  if (route.kind === 'editor' || route.kind === 'edit') {
    return (
      <Editor
        onBack={() => navigate('/')}
        onNavigate={navigate}
        onReplace={replace}
        editId={route.kind === 'edit' ? route.editId : undefined}
      />
    );
  }

  return <Home onCreate={() => navigate(EDITOR_PATH)} onNavigate={navigate} />;
}

export function App() {
  return <ThemeProvider><CurrentRoute /></ThemeProvider>;
}
