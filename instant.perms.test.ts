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
    expect(rules.$files.allow.create).toBe('true');
    expect(rules.$files.allow.delete).toBe("data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/') && ruleParams.editId != null");
  });

  it('lets retention be stamped on a pasted image under the same gate as deleting it', () => {
    // Anything the retention write can reach, the delete rule could already reach.
    expect(rules.$files.allow.update).toBe(rules.$files.allow.delete);
    expect(rules.$files.allow.update).toContain('ruleParams.editId != null');
  });
});
