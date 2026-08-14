import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const documents = vi.hoisted(() => new Map<string, { id: string; editId: string; title: string; markdown: string }>());
const publishDocument = vi.hoisted(() => vi.fn(async (markdown: string, existing?: { id: string; editId: string }): Promise<{ kind: 'published'; document: { id: string; editId: string; title: string; markdown: string } } | { kind: 'failed' }> => {
  const document = { id: existing?.id ?? 'saved-document', editId: existing?.editId ?? 'private-edit-capability', title: 'Saved document', markdown };
  documents.set(document.id, document);
  return { kind: 'published' as const, document };
}));

vi.mock('./lib/instant-document-persistence', () => ({
  documentLifecycle: {
    attachImage: () => ({ kind: 'unsupported' as const }),
    save: publishDocument,
    delete: vi.fn(async () => ({ kind: 'deleted' as const })),
    rotate: vi.fn(async (existing: { id: string; editId: string }) => ({ kind: 'rotated' as const, document: { id: existing.id, editId: 'replacement-edit-capability' } })),
    useShareDocument: (id: string) => {
      const document = documents.get(id);
      return document ? { kind: 'available', document: { id: document.id, title: document.title, markdown: document.markdown } } : { kind: 'unavailable' };
    },
    useEditDocument: (editId: string) => {
      if (!editId) return { kind: 'unavailable' };
      const document = [...documents.values()].find((candidate) => candidate.editId === editId);
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
  publishDocument.mockClear();
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

    window.history.replaceState({}, '', '/e/private-edit-capability');
    fireEvent.popState(window);
    expect(await screen.findByRole('textbox', { name: 'Markdown document' })).toHaveValue('# Private revision');
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');
    expect(publishDocument).toHaveBeenLastCalledWith('# Private revision', expect.objectContaining({ id: 'saved-document', editId: 'private-edit-capability' }), { expiresAt: null });
    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByRole('heading', { name: 'Private revision' })).toBeInTheDocument();
  });

  it('starts a new document after a clean saved session is reopened', async () => {
    const first = render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Original' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    first.unmount();
    window.history.replaceState({}, '', '/new');
    render(<App />);
    expect(screen.getByRole('textbox', { name: 'Markdown document' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Separate' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');

    expect(publishDocument).toHaveBeenLastCalledWith('# Separate', undefined, { expiresAt: null });
  });

  it('keeps an unsaved new-document draft after a different edit link is opened', async () => {
    const first = render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Unsaved new draft' } });
    expect(window.localStorage.getItem('markshare-editor-recovery-v1')).toContain('# Unsaved new draft');
    first.unmount();

    documents.set('other-document', { id: 'other-document', editId: 'other-edit-capability', title: 'Other notes', markdown: '# Other notes' });
    window.history.replaceState({}, '', '/e/other-edit-capability');
    const second = render(<App />);
    expect(await screen.findByRole('textbox', { name: 'Markdown document' })).toHaveValue('# Other notes');
    expect(window.localStorage.getItem('markshare-editor-recovery-v1')).toContain('# Unsaved new draft');
    second.unmount();

    window.history.replaceState({}, '', '/new');
    render(<App />);
    expect(await screen.findByText('Recovered unsaved local draft.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Markdown document' })).toHaveValue('# Unsaved new draft');
  });

  it('does not rewrite remembered edit access while typing', async () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem');
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Access' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await screen.findByText('Changes saved.');
    setItem.mockClear();

    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Access\n\nMore words' } });
    expect(setItem.mock.calls.filter(([key]) => key === 'markshare-edit-access-v1')).toEqual([]);
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
    fireEvent.keyDown(splitter, { key: 'End' });
    expect(splitter).toHaveAttribute('aria-valuenow', '78');
    fireEvent.doubleClick(splitter);
    expect(splitter).toHaveAttribute('aria-valuenow', '50');
  });

  it('keeps editing available after a save failure and retries on the next explicit save', async () => {
    publishDocument.mockRejectedValueOnce(new Error('network unavailable'));
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Retry me' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('We could not save this document. Please try again.');
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toHaveFocus();
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled();
    fireEvent.keyDown(done, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(publishDocument).toHaveBeenCalledTimes(2);
  });

  it('shows an import-specific error when a file cannot be read', async () => {
    render(<App />);
    const file = Object.assign(new File([''], 'broken.md', { type: 'text/markdown' }), { text: () => Promise.reject(new Error('unreadable')) });
    fireEvent.change(screen.getByLabelText('Import .md'), { target: { files: [file] } });

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Markdown not imported');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('We could not import that Markdown file. Please try again.');
  });

  it('switches between the edit and preview tabs without replacing the draft', () => {
    render(<App />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Markdown document' }), { target: { value: '# Tabs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(screen.getByRole('main')).toHaveAttribute('data-tab', 'preview');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Markdown document' })).toHaveValue('# Tabs');
  });
});
