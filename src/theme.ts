export type ThemePreference = 'system' | 'light' | 'dark';

export const themeOrder: ThemePreference[] = ['system', 'light', 'dark'];
const storageKey = 'markshare-theme';

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;
}

export function nextTheme(preference: ThemePreference): ThemePreference {
  return themeOrder[(themeOrder.indexOf(preference) + 1) % themeOrder.length];
}

export function getStoredTheme(): ThemePreference {
  const stored = window.localStorage.getItem(storageKey);
  return themeOrder.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
}

export function applyTheme(preference: ThemePreference, systemIsDark: boolean): void {
  document.documentElement.dataset.theme = resolveTheme(preference, systemIsDark);
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
}

export function storeTheme(preference: ThemePreference): void {
  window.localStorage.setItem(storageKey, preference);
}
