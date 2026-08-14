import { createDocumentLifecycle, type DocumentPersistence, type PersistedShareOutcome } from '../document-lifecycle';
import { createDocumentId, db } from './instant';

const instantDocumentPersistence: DocumentPersistence = {
  async save(document) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[document.id].ruleParams({ knownDocumentId: document.id, editId: document.editId }).update({
      title: document.title,
      markdown: document.markdown,
      editId: document.editId,
      updatedAt: document.updatedAt,
      ...(document.createdAt ? { createdAt: document.createdAt } : {}),
      ...('expiresAt' in document ? { expiresAt: document.expiresAt } : {}),
    }));
    return 'published';
  },

  useShareDocument(id): PersistedShareOutcome {
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

  async markDeleted(id, editId, deletedAt) {
    if (!db) return 'not-configured';

    await db.transact(db.tx.documents[id].ruleParams({ knownDocumentId: id, editId }).update({
      deletedAt,
      updatedAt: deletedAt,
    }));
    return 'deleted';
  },
};

export const documentLifecycle = createDocumentLifecycle(instantDocumentPersistence, createDocumentId);
