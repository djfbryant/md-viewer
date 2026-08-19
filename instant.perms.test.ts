import { describe, expect, it } from 'vitest';
import rules from './instant.perms';

describe('document permissions', () => {
  it('lets a Share Link read a document and keeps writes to signed-in owners and editors', () => {
    expect(rules.documents.allow.view).toContain('data.id == ruleParams.knownDocumentId');
    expect(rules.documents.allow.view).toContain("auth.id in data.ref('owner.id')");
    expect(rules.documents.allow.view).toContain("auth.id in data.ref('editors.id')");
    expect(rules.documents.allow.create).toContain("auth.ref('$user.creator.id') != []");
    expect(rules.documents.allow.update).toContain("auth.id in data.ref('owner.id')");
    expect(rules.documents.allow.update).toContain("auth.id in data.ref('editors.id')");
    expect(rules.documents.allow.delete).toBe('false');
  });

  it('stops anonymous file upload and still serves images only with a known document ID', () => {
    expect(rules.$files.allow.view).toBe("data.path.startsWith('documents/' + ruleParams.knownDocumentId + '/')");
    expect(rules.$files.allow.create).toBe("auth.ref('$user.creator.id') != []");
    expect(rules.$files.allow.delete).toContain("auth.ref('$user.creator.id') != []");
  });

  it('lets an invited creator claim their row and see other creators', () => {
    expect(rules.creators.allow.view).toContain('data.email == auth.email');
    expect(rules.creators.allow.create).toBe('false');
    expect(rules.creators.allow.update).toBe('data.email == auth.email');
  });

  it('lets retention be stamped on a pasted image under the same gate as deleting it', () => {
    expect(rules.$files.allow.update).toBe(rules.$files.allow.delete);
    expect(rules.$files.allow.update).toContain("auth.ref('$user.creator.id') != []");
  });
});
