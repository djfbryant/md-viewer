import { describe, expect, it } from 'vitest';
import rules from './instant.perms';

describe('document permissions', () => {
  it('keeps the private edit capability out of every query result', () => {
    expect(rules.documents.fields?.editId).toBe('false');
    expect(rules.documents.allow.update).toContain('data.editId == ruleParams.editId');
    expect(rules.documents.allow.update).toContain('newData.editId == data.editId');
  });
});
