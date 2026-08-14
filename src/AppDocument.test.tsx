import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => {
  const documents: Array<{ id: string; title: string; markdown: string }> = [];
  return documents;
});

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg role="img" viewBox="0 0 1804 200"></svg>' })),
}));

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

vi.mock('mermaid', () => ({ default: mermaidApi }));

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
  it('uses the same adaptive Mermaid presentation in Preview and the Share Link', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains('markdown') ? 600
        : this.classList.contains('preview') || this.classList.contains('reader-content') ? 1000
          : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) };
    });
    const markdown = '```mermaid\nwide diagram\n```';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: markdown } });

    const previewDiagram = await screen.findByRole('img', { name: 'Mermaid diagram' });
    expect(previewDiagram.closest('.mermaid-diagram')).toHaveAttribute('data-mermaid-wide', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Open Mermaid diagram in expanded view' }));
    expect(await screen.findByRole('dialog', { name: 'Expanded Mermaid diagram' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close diagram viewer' }));

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    fireEvent.click(await screen.findByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    const readerDiagram = await screen.findByRole('img', { name: 'Mermaid diagram' });
    expect(readerDiagram.closest('.mermaid-diagram')).toHaveAttribute('data-mermaid-wide', 'true');
    expect(screen.getByRole('button', { name: 'Open Mermaid diagram in expanded view' })).toBeInTheDocument();
  });

  it('publishes Markdown with an opaque read-only share link and renders it for a reader', async () => {
    const markdown = '# Release notes\n\nHello **reader**.';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: markdown } });

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    const previewMarkup = screen.getByLabelText('Document preview').querySelector('article')?.innerHTML;
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost\/s\/opaque-document-id/)).toBeInTheDocument();
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
    document.title = 'Previously viewed secret · MarkShare';
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(document.title).toBe('MarkShare');
    expect(screen.queryByText('Hello reader')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
  });
});
