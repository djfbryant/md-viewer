import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => new Map<string, { id: string; title: string; markdown: string }>());

vi.mock('./lib/instant-document-persistence', () => ({
  documentLifecycle: {
    publish: vi.fn(async (markdown: string) => {
      const document = { id: 'saved-document', title: 'Saved document', markdown };
      documents.set(document.id, document);
      return { kind: 'published', document };
    }),
    useShareDocument: (id: string) => {
      const document = documents.get(id);
      return document ? { kind: 'available', document } : { kind: 'unavailable' };
    },
  },
}));

import { App } from './App';

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  HTMLElement.prototype.setPointerCapture = vi.fn();
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  window.history.replaceState({}, '', '/new');
  documents.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('editor session', () => {
  it('recovers unpublished work after the editor is reopened', async () => {
    const first = render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Recovered' } });
    expect(window.localStorage.getItem('markshare-editor-recovery-v1')).toContain('# Recovered');

    first.unmount();
    render(<App />);

    expect(await screen.findByText('Recovered unsaved local draft.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Markdown document' })).toHaveValue('# Recovered');
  });

  it('imports Markdown and keeps private changes out of the reader until Save changes', async () => {
    render(<App />);
    const file = Object.assign(new File(['# Imported'], 'notes.md', { type: 'text/markdown' }), { text: async () => '# Imported' });
    fireEvent.change(screen.getByLabelText('Import .md'), { target: { files: [file] } });

    expect(await screen.findByRole('heading', { name: 'Imported' })).toBeInTheDocument();
    expect(screen.getByText('not yet published')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Private revision' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    window.history.pushState({}, '', '/s/saved-document');
    fireEvent.popState(window);

    expect(await screen.findByRole('heading', { name: 'Imported' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Private revision' })).not.toBeInTheDocument();
  });

  it('clamps, resets, and cleans up the accessible splitter interaction', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 0, width: 100, height: 0, toJSON: () => ({}) });
    render(<App />);
    const splitter = screen.getByRole('separator', { name: 'Resize the write and preview panes' });

    fireEvent.pointerDown(splitter, { pointerId: 1 });
    fireEvent.pointerMove(splitter, { pointerId: 1, clientX: 99 });
    expect(document.body).toHaveClass('is-resizing');
    fireEvent.pointerCancel(splitter, { pointerId: 1 });
    expect(splitter).toHaveAttribute('aria-valuenow', '78');
    expect(document.body).not.toHaveClass('is-resizing');

    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
    expect(splitter).toHaveAttribute('aria-valuenow', '68');
    fireEvent.doubleClick(splitter);
    expect(splitter).toHaveAttribute('aria-valuenow', '50');
  });
});
