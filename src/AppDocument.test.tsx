import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const instant = vi.hoisted(() => {
  const documents: Array<{ id: string; title: string; markdown: string }> = [];
  const transact = vi.fn(async (transaction: { value: { id: string; title: string; markdown: string } }) => {
    documents.push(transaction.value);
  });
  return { documents, transact };
});

vi.mock('./lib/instant', () => ({
  createDocumentId: () => 'opaque-document-id',
  db: {
    transact: instant.transact,
    tx: {
      documents: new Proxy({}, {
        get: (_, id: string) => ({
          ruleParams: () => ({ update: (value: { title: string; markdown: string }) => ({ value: { id, ...value } }) }),
        }),
      }),
    },
    useQuery: (query: { documents: { $: { where: { id: string } } } }) => ({
      data: { documents: instant.documents.filter((document) => document.id === query.documents.$.where.id) },
      error: undefined,
      isLoading: false,
    }),
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
  instant.documents.length = 0;
  instant.transact.mockClear();
  window.history.replaceState({}, '', '/');
  window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

afterEach(cleanup);

describe('basic anonymous documents', () => {
  it('publishes Markdown with an opaque read-only share link and renders it for a reader', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /markdown document/i }), { target: { value: '# Release notes\n\nHello **reader**.' } });

    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /publish/i }));

    expect(await screen.findByRole('heading', { name: 'Your document is live' })).toBeInTheDocument();
    expect(screen.getAllByText(/http:\/\/localhost\/s\/opaque-document-id/)).toHaveLength(2);
    expect(instant.transact).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({
      id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.',
    }) }));

    fireEvent.click(screen.getByRole('button', { name: /open share link/i }));
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Release notes' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
  });

  it('does not disclose document content for an unknown share link', () => {
    window.history.replaceState({}, '', '/s/not-a-document');
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.queryByText('Hello reader')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
  });
});
