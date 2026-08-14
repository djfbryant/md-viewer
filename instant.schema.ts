import { i } from '@instantdb/react';

// The document ID is generated client-side as the opaque share capability.
// The edit ID remains private to the editor session; it is not part of a Share Link.
const schema = i.graph({
  documents: i.entity({
    title: i.string(),
    markdown: i.string(),
    editId: i.string(),
    createdAt: i.date(),
    updatedAt: i.date(),
    expiresAt: i.date().optional(),
    deletedAt: i.date().optional(),
  }),
}, {});

export type AppSchema = typeof schema;
export default schema;
