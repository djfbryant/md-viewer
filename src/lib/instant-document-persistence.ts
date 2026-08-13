import { createDocumentLifecycle, type DocumentPersistence, type ShareDocumentOutcome } from '../document-lifecycle';
import { createDocumentId, db } from './instant';

const instantDocumentPersistence: DocumentPersistence = {
  async publish(document) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[document.id].ruleParams({ knownDocumentId: document.id }).update({
      title: document.title,
      markdown: document.markdown,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }));
    return 'published';
  },

  useShareDocument(id): ShareDocumentOutcome {
    if (!db) return { kind: 'unavailable' };

    const { data, error, isLoading } = db.useQuery(
      { documents: { $: { where: { id } } } },
      { ruleParams: { knownDocumentId: id } },
    );

    if (isLoading) return { kind: 'loading' };
    const document = data?.documents[0];
    return error || !document
      ? { kind: 'unavailable' }
      : { kind: 'available', document };
  },
};

export const documentLifecycle = createDocumentLifecycle(instantDocumentPersistence, createDocumentId);
