import { i } from '@instantdb/react';

// The document ID is generated client-side as the opaque share capability.
// The edit ID remains private to the editor session; it is not part of a Share Link.
// Pasted images live at documents/{documentId}/{imageId} and are retrieved only
// with that document capability.
const schema = i.graph({
  $files: i.entity({
    path: i.string().unique().indexed(),
    url: i.string(),
    expiresAt: i.date().optional(),
  }),
  documents: i.entity({
    title: i.string(),
    markdown: i.string(),
    editId: i.string().unique().indexed(),
    createdAt: i.date(),
    updatedAt: i.date(),
    expiresAt: i.date().optional(),
    deletedAt: i.date().optional(),
  }),
}, {});

export type AppSchema = typeof schema;
export default schema;
