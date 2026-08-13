import { i } from '@instantdb/react';

// The schema intentionally establishes the Document boundary now; publishing,
// owner capabilities, images, and expiry are added by their respective issues.
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
