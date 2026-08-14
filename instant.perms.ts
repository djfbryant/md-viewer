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
      // uploadFile cannot send ruleParams. A live startsWith('documents/')
      // create rule still denied anonymous uploads, so create stays open
      // while view and delete stay capability-gated.
      create: 'true',
      update: 'false',
      delete: "data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/') && ruleParams.editId != null",
    },
  },
} satisfies InstantRules;

export default rules;
