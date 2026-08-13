import { describe, expect, it, vi } from 'vitest';
import { createDocumentLifecycle, type DocumentPersistence } from './document-lifecycle';

function memoryPersistence(): DocumentPersistence & { documents: Map<string, { id: string; title: string; markdown: string }> } {
  const documents = new Map<string, { id: string; title: string; markdown: string }>();
  return {
    documents,
    async publish(document) { documents.set(document.id, document); return 'published'; },
    useShareDocument(id) {
      const document = documents.get(id);
      return document ? { kind: 'available', document } : { kind: 'unavailable' };
    },
  };
}

describe('Document lifecycle', () => {
  it('publishes a titled document that a holder of its share ID can read', async () => {
    const persistence = memoryPersistence();
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id', () => new Date('2026-08-13T12:00:00Z'));

    const published = await lifecycle.publish('# Release notes\n\nHello **reader**.');

    expect(published).toEqual({
      kind: 'published',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
    expect(lifecycle.useShareDocument('opaque-document-id')).toEqual({
      kind: 'available',
      document: { id: 'opaque-document-id', title: 'Release notes', markdown: '# Release notes\n\nHello **reader**.' },
    });
  });

  it('returns an unavailable outcome for an unknown share ID', () => {
    const lifecycle = createDocumentLifecycle(memoryPersistence(), () => 'opaque-document-id');
    expect(lifecycle.useShareDocument('unknown')).toEqual({ kind: 'unavailable' });
  });

  it('translates a persistence failure to a generic publish failure', async () => {
    const persistence: DocumentPersistence = {
      publish: vi.fn().mockRejectedValue(new Error('network error')),
      useShareDocument: () => ({ kind: 'unavailable' }),
    };
    const lifecycle = createDocumentLifecycle(persistence, () => 'opaque-document-id');

    await expect(lifecycle.publish('Text')).resolves.toEqual({ kind: 'failed' });
  });

  it('keeps a missing database configuration distinct from a failed publish', async () => {
    const lifecycle = createDocumentLifecycle({
      publish: async () => 'not-configured',
      useShareDocument: () => ({ kind: 'unavailable' }),
    }, () => 'opaque-document-id');

    await expect(lifecycle.publish('Text')).resolves.toEqual({ kind: 'not-configured' });
  });
});
