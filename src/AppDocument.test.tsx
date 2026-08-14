import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => {
  const documents: Array<{ id: string; editId: string; title: string; markdown: string; expiresAt?: Date; deleted?: boolean }> = [];
  return documents;
});

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg role="img" viewBox="0 0 1804 200"></svg>' })),
}));

vi.mock('./lib/instant-document-persistence', () => ({
  documentLifecycle: {
    save: vi.fn(async (markdown: string, _existing?: { id: string; editId: string }, options?: { expiresAt?: Date | null }) => {
      const document = {
        id: 'opaque-document-id',
        editId: documents.find((candidate) => candidate.id === 'opaque-document-id')?.editId ?? 'private-edit-capability',
        title: markdown.startsWith('# ') ? markdown.split('\n')[0].slice(2) : 'Untitled document',
        markdown,
        ...(options?.expiresAt ? { expiresAt: options.expiresAt } : {}),
      };
      const existing = documents.find((candidate) => candidate.id === document.id);
      if (existing) Object.assign(existing, document);
      else documents.push(document);
      return { kind: 'published', document };
    }),
    delete: vi.fn(async () => {
      const document = documents.find((candidate) => candidate.id === 'opaque-document-id');
      if (document) document.deleted = true;
      return { kind: 'deleted' };
    }),
    rotate: vi.fn(async (existing: { id: string; editId: string }) => {
      const document = documents.find((candidate) => candidate.id === existing.id && candidate.editId === existing.editId);
      if (!document) return { kind: 'failed' };
      document.editId = 'replacement-edit-capability';
      return { kind: 'rotated', document: { id: document.id, editId: document.editId } };
    }),
    useShareDocument: (id: string) => {
      const document = documents.find((candidate) => candidate.id === id && !candidate.deleted);
      if (!document) return { kind: 'unavailable' };
      if (document.expiresAt && document.expiresAt.getTime() <= Date.now()) return { kind: 'unavailable' };
      return { kind: 'available', document: { id: document.id, title: document.title, markdown: document.markdown, expiresAt: document.expiresAt } };
    },
    useEditDocument: (editId: string) => {
      if (!editId) return { kind: 'unavailable' };
      const document = documents.find((candidate) => candidate.editId === editId && !candidate.deleted);
      if (!document) return { kind: 'unavailable' };
      if (document.expiresAt && document.expiresAt.getTime() <= Date.now()) return { kind: 'unavailable' };
      return { kind: 'available', document };
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

  it('shows a configured expiry on the share link and uses the same unavailable page after delete', async () => {
    const markdown = '# Expiring notes';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: markdown } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    expect(screen.getByText('Never expires')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.change(screen.getByLabelText('Expiry date and time'), { target: { value: '2026-08-14T18:00' } });
    expect(await screen.findAllByText(/Expires /)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByText(/Expires /)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Expiring notes' })).toBeInTheDocument();
  });

  it('shows the same unavailable response for an expired share link', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Expired notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.change(screen.getByLabelText('Expiry date and time'), { target: { value: '2020-01-01T00:00' } });
    expect(await screen.findAllByText(/Expires /)).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));

    expect(await screen.findByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.getByText('This share link is invalid or the document is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Expired notes' })).not.toBeInTheDocument();
  });

  it('shows the same unavailable response after a document is deleted', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Secret notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete document' }));

    expect(await screen.findByRole('button', { name: /create a document/i })).toBeInTheDocument();
    window.history.replaceState({}, '', '/s/opaque-document-id');
    fireEvent.popState(window);
    expect(await screen.findByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.getByText('This share link is invalid or the document is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Secret notes' })).not.toBeInTheDocument();
  });

  it('opens a private edit link in the editor and keeps the share link read-only', async () => {
    const markdown = '# Private notes\n\nOnly the author can change this.';
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: markdown } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');
    expect(window.location.pathname).toBe('/e/private-edit-capability');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText(/http:\/\/localhost\/e\/private-edit-capability/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('textbox', { name: /markdown document/i })).toHaveValue(markdown);
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Private revision' } });
    expect(screen.getByText('not yet published')).toBeInTheDocument();

    window.history.pushState({}, '', '/s/opaque-document-id');
    fireEvent.popState(window);
    expect(await screen.findByRole('heading', { name: 'Private notes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Private revision' })).not.toBeInTheDocument();
  });

  it('restores edit access from the edit link and forgets a replaced link', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Kept notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    const first = screen.getByRole('textbox', { name: /markdown document/i });
    expect(first).toHaveValue('# Kept notes');

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace edit link' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace edit link' }));
    expect(await screen.findByText(/http:\/\/localhost\/e\/replacement-edit-capability/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    window.history.replaceState({}, '', '/e/private-edit-capability');
    fireEvent.popState(window);
    expect(await screen.findByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();

    window.history.replaceState({}, '', '/e/replacement-edit-capability');
    fireEvent.popState(window);
    expect(await screen.findByRole('textbox', { name: /markdown document/i })).toHaveValue('# Kept notes');
  });

  it('does not disclose an edit control on a share link in a browser that never saved the document', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Shared notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    window.localStorage.removeItem('markshare-edit-access-v1');
    window.history.replaceState({}, '', '/s/opaque-document-id');
    fireEvent.popState(window);

    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByText(/\/e\//)).not.toBeInTheDocument();
  });
});
