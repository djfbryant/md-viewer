import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => {
  const documents: Array<{ id: string; title: string; markdown: string }> = [];
  return documents;
});

vi.mock('./lib/instant-document-persistence', () => ({
  documentLifecycle: {
    publish: vi.fn(async (markdown: string) => {
      const document = { id: 'opaque-document-id', title: markdown.startsWith('# ') ? markdown.split('\n')[0].slice(2) : 'Untitled document', markdown };
      documents.push(document);
      return { kind: 'published', document };
    }),
    useShareDocument: (id: string) => {
      const document = documents.find((candidate) => candidate.id === id);
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
  documents.length = 0;
  window.history.replaceState({}, '', '/');
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('basic anonymous documents', () => {
  it('publishes Markdown with an opaque read-only share link and renders it for a reader', async () => {
    const markdown = '# Release notes\n\nHello **reader**.';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: markdown } });

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    const previewMarkup = screen.getByLabelText('Document preview').querySelector('article')?.innerHTML;
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    expect(await screen.findByRole('heading', { name: 'Your document is live' })).toBeInTheDocument();
    expect(screen.getAllByText(/http:\/\/localhost\/s\/opaque-document-id/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
    expect(document.querySelector('.reader-content article')?.innerHTML).toBe(previewMarkup);
    expect(document.title).toBe('Release notes · MarkShare');

    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:markdown-source');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let download: { filename: string; href: string } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = { filename: this.download, href: this.href };
    });

    fireEvent.click(screen.getByRole('button', { name: 'Download .md' }));

    const downloadedBlob = createObjectURL.mock.calls[0][0];
    expect(downloadedBlob).toBeInstanceOf(Blob);
    expect(downloadedBlob).toMatchObject({ size: new Blob([markdown]).size, type: 'text/markdown;charset=utf-8' });
    expect(download).toEqual({ filename: 'Release notes.md', href: 'blob:markdown-source' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:markdown-source');
  });

  it('does not disclose document content for an unknown share link', () => {
    window.history.replaceState({}, '', '/s/not-a-document');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('Hello reader')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
  });
});
