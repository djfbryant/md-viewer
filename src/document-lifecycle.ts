import { interpretMarkdown } from './markdown';

export type SharedDocument = {
  id: string;
  title: string;
  markdown: string;
};

export type EditableDocument = SharedDocument & {
  editId: string;
};

export type EditCapability = Pick<EditableDocument, 'id' | 'editId'>;

export type ShareDocumentOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: SharedDocument };

export type SaveDocumentOutcome =
  | { kind: 'published'; document: EditableDocument }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

type StoredDocument = EditableDocument & {
  createdAt: Date;
  updatedAt: Date;
};

export interface DocumentPersistence {
  save(document: StoredDocument): Promise<'published' | 'not-configured'>;
  useShareDocument(id: string): ShareDocumentOutcome;
}

export interface DocumentLifecycle {
  save(markdown: string, existing?: EditCapability): Promise<SaveDocumentOutcome>;
  useShareDocument(id: string): ShareDocumentOutcome;
}

export function createDocumentLifecycle(
  persistence: DocumentPersistence,
  generateId: () => string,
  now: () => Date = () => new Date(),
): DocumentLifecycle {
  return {
    async save(markdown, existing) {
      const id = existing?.id ?? generateId();
      const timestamp = now();
      const interpreted = interpretMarkdown(markdown);
      const document = {
        id,
        editId: existing?.editId ?? generateId(),
        title: interpreted.title,
        markdown,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        const result = await persistence.save(document);
        if (result === 'not-configured') return { kind: 'not-configured' };
        return {
          kind: 'published',
          document: { id: document.id, editId: document.editId, title: document.title, markdown: document.markdown },
        };
      } catch {
        return { kind: 'failed' };
      }
    },
    useShareDocument(id) {
      const outcome = persistence.useShareDocument(id);
      if (outcome.kind !== 'available') return outcome;
      return {
        kind: 'available',
        document: {
          id: outcome.document.id,
          title: outcome.document.title,
          markdown: outcome.document.markdown,
        },
      };
    },
  };
}
