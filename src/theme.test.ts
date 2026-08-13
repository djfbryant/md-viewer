import { describe, expect, it } from 'vitest';
import { nextTheme, resolveTheme } from './theme';

describe('theme preference', () => {
  it('cycles through system, light, and dark', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('resolves system against the current OS theme', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
  });
});
