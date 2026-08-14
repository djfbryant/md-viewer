import { useEffect, useMemo, useRef, useState } from 'react';
import { getShareId, sharePath, shareUrl } from './document';
import { type SharedDocument } from './document-lifecycle';
import { documentLifecycle } from './lib/instant-document-persistence';
import { downloadMarkdown, interpretMarkdown, MarkdownView, type InterpretedMarkdown, type MermaidExpandRequest } from './markdown';
import { MermaidViewer } from './mermaid-viewer';
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

/** Keeps Preview and Share Link on the same Mermaid presentation and viewer path. */
function RenderedDocument({ document }: { document: InterpretedMarkdown }) {
  const [expandedMermaid, setExpandedMermaid] = useState<MermaidExpandRequest | null>(null);

  return <>
    <MarkdownView
      document={document}
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
  const interpreted = useMemo(() => interpretMarkdown(markdown), [markdown]);

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
    setIsPublishing(true);
    setPublishError(null);
    const outcome = await documentLifecycle.publish(markdown);
    if (outcome.kind === 'published') {
      setPublishedId(outcome.document.id);
    } else if (outcome.kind === 'not-configured') {
      setPublishError('Publishing needs an InstantDB app. Add VITE_INSTANT_APP_ID to publish this document.');
    } else {
      setPublishError('We could not publish this document. Please try again.');
    }
    setIsPublishing(false);
  };

  return (
    <main className="editor-shell" data-tab={tab}>
      <header className="app-bar">
        <button className="brand brand-button" onClick={onBack} aria-label="Back to MarkShare home"><Brand /></button>
        <div className="document-title">
          <span>{markdown.trim() ? interpreted.title : 'New document'}</span>
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
          <div className="preview"><article className={markdown ? 'markdown' : 'preview-placeholder'}>{markdown ? <RenderedDocument document={interpreted} /> : <><h1>Your preview will appear here</h1><p>Write Markdown, then publish a read-only share link.</p></>}</article></div>
        </section>
      </div>
      <footer className="status-footer"><span>{markdown.trim() ? `${markdown.trim().split(/\s+/).length} words` : 'Draft document'}</span><span className="status-url">{publishedId ? shareUrl(publishedId) : 'Publish to create a share link'}</span></footer>
      {publishError && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-labelledby="publish-error-title"><h2 id="publish-error-title">Document not published</h2><p>{publishError}</p><button className="button button--primary" onClick={() => setPublishError(null)}>Done</button></section></div>}
      {publishedId && <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-labelledby="published-title"><h2 id="published-title">Your document is live</h2><p>Anyone with this link can read it. No one can change it.</p><code className="link-box">{shareUrl(publishedId)}</code><div className="dialog-actions"><button className="button" onClick={() => setPublishedId(null)}>Done</button><button className="button button--primary" onClick={() => onNavigate(sharePath(publishedId))}>Open share link</button></div></section></div>}
    </main>
  );
}

function ReaderLayout({ actions, children, title }: { actions?: React.ReactNode; children: React.ReactNode; title?: string }) {
  useEffect(() => {
    window.document.title = title ? `${title} · MarkShare` : 'MarkShare';
  }, [title]);

  return <main className="reader-shell">
    <header className="app-bar reader-bar"><Brand />{title && <div className="document-title"><span>{title}</span><span className="pill">Read only</span></div>}{actions && <div className="bar-actions">{actions}</div>}</header>
    {children}
  </main>;
}

function Reader({ document }: { document: SharedDocument }) {
  const interpreted = useMemo(() => interpretMarkdown(document.markdown), [document.markdown]);

  return <ReaderLayout
    actions={<button className="button" onClick={() => downloadMarkdown(interpreted)}>Download .md</button>}
    title={interpreted.title}
  ><div className="reader-content"><article className="markdown"><RenderedDocument document={interpreted} /></article></div></ReaderLayout>;
}

function MissingDocument() {
  return <ReaderLayout><section className="reader-message"><h1>Document unavailable</h1><p>This share link is invalid or the document is no longer available.</p></section></ReaderLayout>;
}

function ShareRoute({ documentId }: { documentId: string }) {
  const outcome = documentLifecycle.useShareDocument(documentId);
  if (outcome.kind === 'loading') return <ReaderLayout><section className="reader-message"><p>Opening document…</p></section></ReaderLayout>;
  return outcome.kind === 'available' ? <Reader document={outcome.document} /> : <MissingDocument />;
}

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme());
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    if (!pathname.startsWith('/s/')) window.document.title = 'MarkShare';
  }, [pathname]);

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
  if (pathname.startsWith('/s/')) return shareId ? <ShareRoute documentId={shareId} /> : <MissingDocument />;

  return pathname === '/'
    ? <Home preference={preference} onCycle={cycleTheme} onCreate={() => navigate('/new')} />
    : <Editor preference={preference} onCycle={cycleTheme} onBack={() => navigate('/')} onNavigate={navigate} />;
}
