import { describe, expect, it } from 'vitest';
import rules from './instant.perms';

describe('document permissions', () => {
  it('keeps the private edit capability out of every query result', () => {
    expect(rules.documents.fields?.editId).toBe('false');
  });

  it('lets a share ID read a document and an edit ID update or replace that capability', () => {
    expect(rules.documents.allow.view).toContain('data.id == ruleParams.knownDocumentId');
    expect(rules.documents.allow.view).toContain('data.editId == ruleParams.editId');
    expect(rules.documents.allow.update).toBe('data.editId == ruleParams.editId');
  });

  it('serves pasted images only to a requester who already knows the document ID', () => {
    expect(rules.$files.allow.view).toBe("data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/')");
    expect(rules.$files.allow.create).toBe("data.path.startsWith('documents/')");
    expect(rules.$files.allow.update).toBe('false');
    expect(rules.$files.allow.delete).toBe('false');
  });
});
