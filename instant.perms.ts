import type { InstantRules } from '@instantdb/react';

// A document is visible only when the requester provides its opaque ID. The
// private edit capability is never returned to Share Link holders.
const rules = {
  documents: {
    allow: {
      create: 'true',
      view: 'data.id == ruleParams.knownDocumentId || data.editId == ruleParams.editId',
      update: 'data.editId == ruleParams.editId',
      delete: 'false',
    },
    fields: {
      editId: 'false',
    },
  },
  $files: {
    allow: {
      view: "data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/')",
      create: "data.path.startsWith('documents/')",
      update: 'false',
      delete: 'false',
    },
  },
} satisfies InstantRules;

export default rules;
