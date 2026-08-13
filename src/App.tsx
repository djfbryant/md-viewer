import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { documentTitle, getShareId, sharePath, shareUrl } from './document';
import { createDocumentId, db } from './lib/instant';
import { applyTheme, getStoredTheme, nextTheme, type ThemePreference, storeTheme } from './theme';

const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 22;
const MAX_SPLIT = 78;
function ThemeButton({ preference, onCycle }: { preference: ThemePreference; onCycle: () => void }) {
  const symbol = preference === 'system' ? '◐' : preference === 'light' ? '☀' : '☾';
  return (
    <button className="button button--quiet button--small" onClick={onCycle} aria-label={`Theme: ${preference}. Change theme`} title={`Theme: ${preference}`}>
      <span aria-hidden="true">{symbol}</span>
    </button>
  );
}

function Brand({ showName = true }: { showName?: boolean }) {
  return <div className="brand"><span className="mark" aria-hidden="true" />{showName && <span className="brand-name">MarkShare</span>}</div>;
}

function Home({ preference, onCycle, onCreate }: { preference: ThemePreference; onCycle: () => void; onCreate: () => void }) {
  return (
    <main className="home-shell">
      <header className="app-bar home-bar">
        <Brand />
        <div className="bar-actions"><ThemeButton preference={preference} onCycle={onCycle} /></div>
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
      <footer className="home-footer">Private by default · Built for clear thinking</footer>
    </main>
  );
}

function Editor({ preference, onCycle, onBack, onNavigate }: { preference: ThemePreference; onCycle: () => void; onBack: () => void; onNavigate: (path: string) => void }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [split, setSplit] = useState(DEFAULT_SPLIT);
  const [markdown, setMarkdown] = useState('');
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const applySplit = (next: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(next)));
    panesRef.current?.style.setProperty('--split', `${clamped}%`);
    return clamped;
  };

  const startDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    document.body.classList.add('is-resizing');
  };

  const moveDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging.current || !panesRef.current) return;
    const rect = panesRef.current.getBoundingClientRect();
    applySplit(((event.clientX - rect.left) / rect.width) * 100);
  };

  const endDrag = () => {
    if (!dragging.current || !panesRef.current) return;
    dragging.current = false;
    document.body.classList.remove('is-resizing');
    setSplit(Number.parseFloat(panesRef.current.style.getPropertyValue('--split')) || DEFAULT_SPLIT);
  };

  const resetSplit = () => {
    applySplit(DEFAULT_SPLIT);
    setSplit(DEFAULT_SPLIT);
  };

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const amount = event.shiftKey ? 10 : 2;
    if (event.key === 'ArrowLeft') { event.preventDefault(); setSplit(applySplit(split - amount)); }
    if (event.key === 'ArrowRight') { event.preventDefault(); setSplit(applySplit(split + amount)); }
    if (event.key === 'Home') { event.preventDefault(); resetSplit(); }
  };

  const publish = async () => {
    if (!db) {
      setPublishError('Publishing needs an InstantDB app. Add VITE_INSTANT_APP_ID to publish this document.');
      return;
    }

    const id = createDocumentId();
    setIsPublishing(true);
    setPublishError(null);
    try {
      await db.transact(db.tx.documents[id].ruleParams({ knownDocumentId: id }).update({
        title: documentTitle(markdown),
        markdown,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      setPublishedId(id);
    } catch {
      setPublishError('We could not publish this document. Please try again.');
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <main className="editor-shell" data-tab={tab}>
      <header className="app-bar">
        <button className="brand brand-button" onClick={onBack} aria-label="Back to MarkShare home"><Brand /></button>
        <div className="document-title">
          <span>New document</span>
          <span className="pill pill--saved">Draft</span>
        </div>
        <div className="bar-actions">
          <ThemeButton preference={preference} onCycle={onCycle} />
          <button className="button button--primary" onClick={publish} disabled={isPublishing}><span className="save-long">{isPublishing ? 'Publishing…' : 'Publish'}</span><span className="save-short">↗</span></button>
        </div>
      </header>
      <nav className="tabs" aria-label="Document workspace">
        <div className="segmented-control">
          <button className={tab === 'write' ? 'active' : ''} onClick={() => setTab('write')}>Edit</button>
          <button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}>Preview</button>
        </div>
      </nav>
      <div className="panes" ref={panesRef} style={{ '--split': `${split}%` } as React.CSSProperties}>
        <section className="pane pane-write" aria-label="Markdown editor">
          <div className="pane-head"><span className="label">Write</span></div>
          <textarea aria-label="Markdown document" placeholder="# Start writing" spellCheck={false} value={markdown} onChange={(event) => setMarkdown(event.target.value)} />
        </section>
        <button className="splitter" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={resetSplit} onKeyDown={resizeByKeyboard} role="separator" aria-orientation="vertical" aria-label="Resize the write and preview panes" aria-valuenow={Math.round(split)} aria-valuemin={MIN_SPLIT} aria-valuemax={MAX_SPLIT} title="Drag to resize · double-click to reset" />
        <section className="pane pane-preview" aria-label="Document preview">
          <div className="pane-head"><span className="label">Preview</span><span className="preview-note">matches share link</span></div>
          <div className="preview"><article className={markdown ? 'markdown' : 'preview-placeholder'}>{markdown ? <ReactMarkdown>{markdown}</ReactMarkdown> : <><h1>Your preview will appear here</h1><p>Write Markdown, then publish a read-only share link.</p></>}</article></div>
        </section>
      </div>
      <footer className="status-footer"><span>{markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : 'Draft document'}</span><span className="status-url">{publishedId ? shareUrl(publishedId) : 'Publish to create a share link'}</span></footer>
      {publishError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="publish-error-title"><h2 id="publish-error-title">Document not published</h2><p>{publishError}</p><button className="button button--primary" onClick={() => setPublishError(null)}>Done</button></section></div>}
      {publishedId && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-labelledby="published-title"><h2 id="published-title">Your document is live</h2><p>Anyone with this link can read it. No one can change it.</p><code className="link-box">{shareUrl(publishedId)}</code><div className="dialog-actions"><button className="button" onClick={() => setPublishedId(null)}>Done</button><button className="button button--primary" onClick={() => onNavigate(sharePath(publishedId))}>Open share link</button></div></section></div>}
    </main>
  );
}

type SharedDocument = { id: string; title: string; markdown: string };

function Reader({ document }: { document: SharedDocument }) {
  return <main className="reader-shell">
    <header className="app-bar reader-bar"><Brand /><div className="document-title"><span>{document.title}</span><span className="pill">Read only</span></div></header>
    <div className="reader-content"><article className="markdown"><ReactMarkdown>{document.markdown}</ReactMarkdown></article></div>
  </main>;
}

function MissingDocument() {
  return <main className="reader-shell"><header className="app-bar reader-bar"><Brand /></header><section className="reader-message"><h1>Document unavailable</h1><p>This share link is invalid or the document is no longer available.</p></section></main>;
}

function ConfiguredShareReader({ documentId }: { documentId: string }) {
  const { data, error, isLoading } = db!.useQuery({ documents: { $: { where: { id: documentId } } } }, { ruleParams: { knownDocumentId: documentId } });
  if (isLoading) return <main className="reader-shell"><header className="app-bar reader-bar"><Brand /></header><section className="reader-message"><p>Opening document…</p></section></main>;
  const document = data?.documents[0] as SharedDocument | undefined;
  return error || !document ? <MissingDocument /> : <Reader document={document} />;
}

function ShareRoute({ documentId }: { documentId: string }) {
  return db ? <ConfiguredShareReader documentId={documentId} /> : <MissingDocument />;
}

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme());
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    document.title = 'MarkShare';
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const updateSystemTheme = (event: MediaQueryListEvent) => setIsDark(event.matches);
    media.addEventListener('change', updateSystemTheme);
    return () => media.removeEventListener('change', updateSystemTheme);
  }, []);

  useEffect(() => applyTheme(preference, isDark), [preference, isDark]);

  useEffect(() => {
    const updatePathname = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', updatePathname);
    return () => window.removeEventListener('popstate', updatePathname);
  }, []);

  const cycleTheme = () => {
    const next = nextTheme(preference);
    storeTheme(next);
    setPreference(next);
  };

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setPathname(path);
  };

  const shareId = getShareId(pathname);
  if (shareId) return <ShareRoute documentId={shareId} />;

  return pathname === '/'
    ? <Home preference={preference} onCycle={cycleTheme} onCreate={() => navigate('/new')} />
    : <Editor preference={preference} onCycle={cycleTheme} onBack={() => navigate('/')} onNavigate={navigate} />;
}
