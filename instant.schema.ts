import { i } from '@instantdb/react';

const schema = i.graph({
  $files: i.entity({
    path: i.string().unique().indexed(),
    url: i.string(),
    expiresAt: i.date().optional(),
  }),
  $users: i.entity({
    email: i.string().unique().indexed().optional(),
  }),
  creators: i.entity({
    email: i.string().unique().indexed(),
  }),
  documents: i.entity({
    title: i.string(),
    markdown: i.string(),
    createdAt: i.date(),
    updatedAt: i.date(),
    expiresAt: i.date().optional(),
    deletedAt: i.date().optional(),
  }),
}, {
  creatorUser: {
    forward: { on: 'creators', has: 'one', label: 'user' },
    reverse: { on: '$users', has: 'one', label: 'creator' },
  },
  documentOwner: {
    forward: { on: 'documents', has: 'one', label: 'owner' },
    reverse: { on: '$users', has: 'many', label: 'ownedDocuments' },
  },
  documentEditors: {
    forward: { on: 'documents', has: 'many', label: 'editors' },
    reverse: { on: '$users', has: 'many', label: 'editableDocuments' },
  },
});

export type AppSchema = typeof schema;
export default schema;
