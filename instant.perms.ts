import type { InstantRules } from '@instantdb/react';

const isCreator = "auth.ref('$user.creator.id') != []";
const isOwner = "auth.id in data.ref('owner.id')";
const isEditor = "auth.id in data.ref('editors.id')";
const knownShare = "data.id == ruleParams.knownDocumentId";
const knownFile = "data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/')";
const editorContentOnly = `!(('expiresAt' in request.modifiedFields) || ('deletedAt' in request.modifiedFields))`;

const rules = {
  $users: {
    allow: {
      view: `auth.id == data.id || ${isCreator}`,
      create: 'true',
      update: 'false',
      delete: 'false',
    },
  },
  creators: {
    allow: {
      view: `data.email == auth.email || ${isCreator}`,
      create: 'false',
      update: 'data.email == auth.email',
      delete: 'false',
    },
  },
  documents: {
    allow: {
      create: `${isCreator} && ${isOwner}`,
      view: `${knownShare} || ${isOwner} || ${isEditor}`,
      update: `${isCreator} && (${isOwner} || (${isEditor} && ${editorContentOnly}))`,
      delete: 'false',
    },
  },
  $files: {
    allow: {
      view: knownFile,
      create: isCreator,
      update: `${isCreator} && ${knownFile}`,
      delete: `${isCreator} && ${knownFile}`,
    },
  },
} satisfies InstantRules;

export default rules;
