import type { InstantRules } from '@instantdb/react';

// A document is visible only when the requester provides its opaque ID. This
// makes the Share Link a capability instead of exposing a browsable document list.
const rules = {
  documents: {
    allow: {
      create: 'true',
      view: 'data.id == ruleParams.knownDocumentId',
      update: 'false',
      delete: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
