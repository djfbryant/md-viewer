import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => {
  const documents: Array<{ id: string; editId: string; title: string; markdown: string; expiresAt?: Date; deleted?: boolean }> = [];
  return documents;
});

const imageSourceKind = vi.hoisted(() => ({ remote: false }));

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: '<svg role="img" viewBox="0 0 1804 200"></svg>' })),
}));

vi.mock('./lib/instant-document-persistence', async () => {
  const { attachDocumentImage } = await import('./document-image');
  const imageSourcesFrom = (markdown: string) => Object.fromEntries(
    [...markdown.matchAll(/!\[[^\]]*\]\(markshare-image:([A-Za-z0-9._-]+)\)/g)].map((match) => [
      match[1]!,
      imageSourceKind.remote
        ? `https://instant-storage.s3.amazonaws.com/apps/secret/${match[1]}.png`
        : `blob:${match[1]}`,
    ]),
  );
  return {
  documentLifecycle: {
    attachImage: (file: { name: string; type: string; size: number }, count: number) => (
      attachDocumentImage(file, count, () => `pasted-image-${count + 1}`)
    ),
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
      const imageSources = imageSourcesFrom(document.markdown);
      return {
        kind: 'available',
        document: {
          id: document.id,
          title: document.title,
          markdown: document.markdown,
          expiresAt: document.expiresAt,
          ...(Object.keys(imageSources).length ? { imageSources } : {}),
        },
      };
    },
    useEditDocument: (editId: string) => {
      if (!editId) return { kind: 'unavailable' };
      const document = documents.find((candidate) => candidate.editId === editId && !candidate.deleted);
      if (!document) return { kind: 'unavailable' };
      if (document.expiresAt && document.expiresAt.getTime() <= Date.now()) return { kind: 'unavailable' };
      const imageSources = imageSourcesFrom(document.markdown);
      return { kind: 'available', document: { ...document, ...(Object.keys(imageSources).length ? { imageSources } : {}) } };
    },
  },
  };
});

vi.mock('mermaid', () => ({ default: mermaidApi }));

import { App } from './App';
import { documentLifecycle } from './lib/instant-document-persistence';

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
  imageSourceKind.remote = false;
  window.history.replaceState({}, '', '/');
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    const footerShare = screen.getByRole('textbox', { name: 'Share URL' });
    expect(footerShare).toHaveValue('http://localhost/s/opaque-document-id');
    fireEvent.click(footerShare);
    expect(footerShare).toHaveProperty('selectionStart', 0);
    expect(footerShare).toHaveProperty('selectionEnd', 'http://localhost/s/opaque-document-id'.length);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    const shareLink = screen.getByRole('textbox', { name: 'Share link — read only' });
    expect(shareLink).toHaveValue('http://localhost/s/opaque-document-id');
    fireEvent.click(shareLink);
    expect(shareLink).toHaveProperty('selectionStart', 0);
    expect(shareLink).toHaveProperty('selectionEnd', 'http://localhost/s/opaque-document-id'.length);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
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
    fireEvent.change(screen.getByLabelText('Expiry date and time'), { target: { value: '2099-01-01T12:00' } });
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
    expect(screen.getByRole('textbox', { name: 'Edit link — private, keep it safe' })).toHaveValue(
      'http://localhost/e/private-edit-capability',
    );
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
    expect(await screen.findByRole('textbox', { name: 'Edit link — private, keep it safe' })).toHaveValue(
      'http://localhost/e/replacement-edit-capability',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    window.history.replaceState({}, '', '/e/private-edit-capability');
    fireEvent.popState(window);
    expect(await screen.findByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();

    window.history.replaceState({}, '', '/e/replacement-edit-capability');
    fireEvent.popState(window);
    expect(await screen.findByRole('textbox', { name: /markdown document/i })).toHaveValue('# Kept notes');
  });

  it('does not keep the previous document visible when opening a different edit link', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Kept notes' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    documents.push({ id: 'other-document-id', editId: 'other-edit-capability', title: 'Other notes', markdown: '# Other notes' });
    window.history.replaceState({}, '', '/e/other-edit-capability');
    fireEvent.popState(window);

    expect(screen.queryByDisplayValue('# Kept notes')).not.toBeInTheDocument();
    expect(await screen.findByRole('textbox', { name: /markdown document/i })).toHaveValue('# Other notes');
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

  it('opens a published share ID on a full page load for a visitor who never authored it', () => {
    const documentId = '52567466-9a13-483a-9e62-335adaf3ca72';
    documents.push({
      id: documentId,
      editId: 'visitor-must-not-see-this',
      title: 'Visitor notes',
      markdown: '# Visitor notes\n\nPublished for a stranger.',
    });
    window.history.replaceState({}, '', `/s/${documentId}`);
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Visitor notes' })).toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByText('Published for a stranger.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/visitor-must-not-see-this/)).not.toBeInTheDocument();
  });

  it('shows the same unavailable page for a truncated share ID', () => {
    const documentId = '52567466-9a13-483a-9e62-335adaf3ca72';
    documents.push({
      id: documentId,
      editId: 'private-edit-capability',
      title: 'Visitor notes',
      markdown: '# Visitor notes',
    });
    window.history.replaceState({}, '', `/s/${documentId.slice(0, 18)}`);
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.getByText('This share link is invalid or the document is no longer available.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Visitor notes' })).not.toBeInTheDocument();
  });

  it('pastes a private image into the editor and renders it on the share link', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted-preview');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const editor = screen.getByRole('textbox', { name: /markdown document/i }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File([new Uint8Array([1, 2, 3])], 'sketch.png', { type: 'image/png' })],
      },
    });

    expect(editor).toHaveValue('# Illustrated notes\n\n![sketch.png](markshare-image:pasted-image-1)\n');
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');
    expect(screen.getByText('1/20 images')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(vi.mocked(documentLifecycle.save).mock.lastCall?.[2]).toEqual(expect.objectContaining({
      images: [expect.objectContaining({ id: 'pasted-image-1' })],
    }));
    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-image-1');
    });
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:pasted-preview');

    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-image-1');
  });

  it('keeps the pasted preview visible until a stored Instant image can be fetched', async () => {
    imageSourceKind.remote = true;
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:pasted-preview')
      .mockReturnValue('blob:resolved-stored-image');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const editor = screen.getByRole('textbox', { name: /markdown document/i }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File([new Uint8Array([1, 2, 3])], 'sketch.png', { type: 'image/png' })],
      },
    });

    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:pasted-preview');
    expect(await screen.findByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:resolved-stored-image');

    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:resolved-stored-image');
  });

  it('drops a supported image into the editor', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dropped-preview');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const editor = screen.getByRole('textbox', { name: /markdown document/i });
    fireEvent.drop(editor, {
      dataTransfer: { files: [new File([new Uint8Array([1])], 'photo.webp', { type: 'image/webp' })] },
    });

    expect(editor).toHaveValue('![photo.webp](markshare-image:pasted-image-1)\n');
    expect(screen.getByRole('img', { name: 'photo.webp' })).toHaveAttribute('src', 'blob:dropped-preview');
  });

  it('explains when a pasted image is larger than the limit', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const oversized = new File([new Uint8Array(8)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.paste(screen.getByRole('textbox', { name: /markdown document/i }), {
      clipboardData: { files: [oversized] },
    });

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Each image must be 5 MB or smaller.');
    expect(screen.queryByRole('img', { name: 'huge.png' })).not.toBeInTheDocument();
  });

  it('omits a leftover pasted image from save when its markdown ref is removed', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted-preview');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const editor = screen.getByRole('textbox', { name: /markdown document/i }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File([new Uint8Array([1, 2, 3])], 'sketch.png', { type: 'image/png' })],
      },
    });

    expect(screen.getByText('1/20 images')).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    expect(screen.getByText('0/20 images')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(vi.mocked(documentLifecycle.save).mock.lastCall?.[2]?.images).toBeUndefined();
  });

  it('uploads a pasted image if its markdown ref is restored before save', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pasted-preview');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    const editor = screen.getByRole('textbox', { name: /markdown document/i }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    editor.setSelectionRange(editor.value.length, editor.value.length);
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File([new Uint8Array([1, 2, 3])], 'sketch.png', { type: 'image/png' })],
      },
    });

    const withImage = editor.value;
    fireEvent.change(editor, { target: { value: '# Illustrated notes' } });
    expect(screen.getByText('0/20 images')).toBeInTheDocument();
    fireEvent.change(editor, { target: { value: withImage } });
    expect(screen.getByText('1/20 images')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(vi.mocked(documentLifecycle.save).mock.lastCall?.[2]).toEqual(expect.objectContaining({
      images: [expect.objectContaining({ id: 'pasted-image-1' })],
    }));
  });
});
