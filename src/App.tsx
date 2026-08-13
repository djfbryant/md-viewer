import { useEffect, useRef, useState } from 'react';
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

function Editor({ preference, onCycle, onBack }: { preference: ThemePreference; onCycle: () => void; onBack: () => void }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [split, setSplit] = useState(DEFAULT_SPLIT);
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
          <button className="button share-button" disabled><span className="share-long">Share</span><span className="share-short" aria-label="Share">↗</span></button>
          <button className="button button--primary" disabled><span className="save-long">Save changes</span><span className="save-short">Save</span></button>
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
          <textarea aria-label="Markdown document" placeholder="# Start writing" spellCheck={false} />
        </section>
        <button className="splitter" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onDoubleClick={resetSplit} onKeyDown={resizeByKeyboard} role="separator" aria-orientation="vertical" aria-label="Resize the write and preview panes" aria-valuenow={Math.round(split)} aria-valuemin={MIN_SPLIT} aria-valuemax={MAX_SPLIT} title="Drag to resize · double-click to reset" />
        <section className="pane pane-preview" aria-label="Document preview">
          <div className="pane-head"><span className="label">Preview</span><span className="preview-note">not available yet</span></div>
          <div className="preview"><article className="preview-placeholder"><h1>Your preview will appear here</h1><p>Markdown rendering and publishing arrive in the next milestone.</p></article></div>
        </section>
      </div>
      <footer className="status-footer"><span>Draft document</span><span className="status-url">Sharing becomes available when published</span></footer>
    </main>
  );
}

export function App() {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme());
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [view, setView] = useState<'home' | 'editor'>('home');

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

  const cycleTheme = () => {
    const next = nextTheme(preference);
    storeTheme(next);
    setPreference(next);
  };

  return view === 'home'
    ? <Home preference={preference} onCycle={cycleTheme} onCreate={() => setView('editor')} />
    : <Editor preference={preference} onCycle={cycleTheme} onBack={() => setView('home')} />;
}
