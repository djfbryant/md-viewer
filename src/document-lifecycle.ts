export type SharedDocument = {
  id: string;
  title: string;
  markdown: string;
};

export type ShareDocumentOutcome =
  | { kind: 'loading' }
  | { kind: 'unavailable' }
  | { kind: 'available'; document: SharedDocument };

export type PublishDocumentOutcome =
  | { kind: 'published'; document: SharedDocument }
  | { kind: 'not-configured' }
  | { kind: 'failed' };

type StoredDocument = SharedDocument & {
  createdAt: Date;
  updatedAt: Date;
};

export interface DocumentPersistence {
  publish(document: StoredDocument): Promise<'published' | 'not-configured'>;
  useShareDocument(id: string): ShareDocumentOutcome;
}

export interface DocumentLifecycle {
  publish(markdown: string): Promise<PublishDocumentOutcome>;
  useShareDocument(id: string): ShareDocumentOutcome;
}

export function createDocumentLifecycle(
  persistence: DocumentPersistence,
  generateId: () => string,
  now: () => Date = () => new Date(),
): DocumentLifecycle {
  return {
    async publish(markdown) {
      const id = generateId();
      const timestamp = now();
      const document = {
        id,
        title: documentTitle(markdown),
        markdown,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      try {
        const result = await persistence.publish(document);
        if (result === 'not-configured') return { kind: 'not-configured' };
        return {
          kind: 'published',
          document: { id: document.id, title: document.title, markdown: document.markdown },
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
import { documentTitle } from './document';
