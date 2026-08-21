import { cleanup, render, screen } from '@testing-library/react';
import { createElement, useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useQuery = vi.hoisted(() => vi.fn());

vi.mock('./instant', () => ({
  db: {
    useQuery,
    transact: vi.fn(),
    queryOnce: vi.fn(),
    storage: { uploadFile: vi.fn() },
    tx: { documents: {}, $files: {} },
  },
  createDocumentId: () => 'generated-id',
}));

import { documentLifecycle } from './instant-document-persistence';

const documentId = '52567466-9a13-483a-9e62-335adaf3ca72';

afterEach(cleanup);

describe('Instant share lookup', () => {
  function Probe({ id }: { id: string }) {
    const outcome = documentLifecycle.useShareDocument(id);
    return createElement('div', null, JSON.stringify(outcome));
  }

  beforeEach(() => {
    useQuery.mockReset();
    useQuery.mockReturnValue({
      data: {
        documents: [{ id: documentId, title: 'Notes', markdown: '# Notes' }],
        $files: [],
      },
      error: null,
      isLoading: false,
    });
  });

  it('queries the document by id and passes knownDocumentId', () => {
    render(createElement(Probe, { id: documentId }));

    expect(useQuery).toHaveBeenCalledWith(
      {
        documents: { $: { where: { id: documentId } } },
        $files: { $: { where: { path: { $like: `documents/${documentId}/%` } } } },
      },
      { ruleParams: { knownDocumentId: documentId } },
    );
    expect(JSON.parse(screen.getByText(/kind/).textContent!)).toMatchObject({ kind: 'available', document: { id: documentId, markdown: '# Notes' } });
  });

  it('treats a share lookup error as unavailable without disclosing the document', () => {
    useQuery.mockReturnValue({
      data: { documents: [{ id: documentId, title: 'Notes', markdown: '# Notes' }], $files: [] },
      error: { message: 'permission denied' },
      isLoading: false,
    });

    render(createElement(Probe, { id: documentId }));
    expect(useQuery).toHaveBeenCalledWith(
      expect.anything(),
      { ruleParams: { knownDocumentId: documentId } },
    );
    expect(screen.getByText(/kind/).textContent).toBe(JSON.stringify({ kind: 'unavailable' }));
  });
});

describe('Instant edit lookup', () => {
  function Probe({ id, userId }: { id: string; userId: string | null }) {
    const outcome = documentLifecycle.useEditDocument(id, userId);
    return createElement('div', null, outcome.kind);
  }

  beforeEach(() => {
    useQuery.mockReset();
    // Instant's useQuery memoizes its subscribe callback. Skipping that call on /new,
    // then making it after Save replaces the path, is the production crash.
    useQuery.mockImplementation((query) => {
      useCallback(() => undefined, [JSON.stringify(query ?? null)]);
      if (!query) {
        return { data: undefined, error: null, isLoading: false };
      }
      return {
        data: {
          documents: [{
            id: documentId,
            title: 'Notes',
            markdown: '# Notes',
            owner: { id: 'owner-user' },
            editors: [],
          }],
          $files: [],
        },
        error: null,
        isLoading: false,
      };
    });
  });

  it('still queries Instant while the editor is on /new so Save can replace the path', () => {
    render(createElement(Probe, { id: '', userId: 'owner-user' }));
    expect(useQuery).toHaveBeenCalledWith(null);
  });

  it('keeps Instant query hooks stable when a first save replaces /new with a document id', () => {
    const { rerender, container } = render(createElement(Probe, { id: '', userId: 'owner-user' }));
    expect(container.textContent).toBe('unavailable');
    rerender(createElement(Probe, { id: documentId, userId: 'owner-user' }));
    expect(container.textContent).toBe('available');
  });

  it('keeps Instant query hooks stable when a signed-out reader later has a user id', () => {
    const { rerender, container } = render(createElement(Probe, { id: documentId, userId: null }));
    expect(container.textContent).toBe('unavailable');
    rerender(createElement(Probe, { id: documentId, userId: 'owner-user' }));
    expect(container.textContent).toBe('available');
  });
});
