import { i } from '@instantdb/react';

// The document ID is generated client-side as the opaque share capability.
// Edit capabilities, images, expiry, and moderation metadata arrive later.
const schema = i.graph({
  documents: i.entity({
    title: i.string(),
    markdown: i.string(),
    createdAt: i.date(),
    updatedAt: i.date(),
  }),
}, {});

export type AppSchema = typeof schema;
export default schema;
