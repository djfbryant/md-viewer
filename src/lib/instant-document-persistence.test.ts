import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Instant share lookup', () => {
  const documentId = '52567466-9a13-483a-9e62-335adaf3ca72';

  beforeEach(() => {
    useQuery.mockClear();
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
    const outcome = documentLifecycle.useShareDocument(documentId);

    expect(useQuery).toHaveBeenCalledWith(
      {
        documents: { $: { where: { id: documentId } } },
        $files: { $: { where: { path: { $like: `documents/${documentId}/%` } } } },
      },
      { ruleParams: { knownDocumentId: documentId } },
    );
    expect(outcome).toMatchObject({ kind: 'available', document: { id: documentId, markdown: '# Notes' } });
  });

  it('treats a share lookup error as unavailable without disclosing the document', () => {
    useQuery.mockReturnValue({
      data: { documents: [{ id: documentId, title: 'Notes', markdown: '# Notes' }], $files: [] },
      error: { message: 'permission denied' },
      isLoading: false,
    });

    expect(documentLifecycle.useShareDocument(documentId)).toEqual({ kind: 'unavailable' });
    expect(useQuery).toHaveBeenCalledWith(
      expect.anything(),
      { ruleParams: { knownDocumentId: documentId } },
    );
  });
});
