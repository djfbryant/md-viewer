export type ThemePreference = 'system' | 'light' | 'dark';

export const themeOrder: ThemePreference[] = ['system', 'light', 'dark'];
export const darkSchemeQuery = '(prefers-color-scheme: dark)';
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

/**
 * The first painted frame must already carry the resolved theme, or a dark visitor sees a flash of
 * light chrome on every cold load. This text runs as a blocking inline script ahead of React, so it
 * cannot import: the storage key, the preferences worth honouring, and the media query are all
 * interpolated from the constants above, and the ternary is resolveTheme written out.
 * theme-boot.test.ts then runs this exact text against getStoredTheme plus resolveTheme for every
 * preference on both kinds of system, so the answer it paints cannot drift from the answer the app
 * would have reached.
 */
export const themeBootScript = `(function () {
  try {
    var stored = window.localStorage.getItem(${JSON.stringify(storageKey)});
    var preference = ${JSON.stringify(themeOrder)}.indexOf(stored) >= 0 ? stored : 'system';
    var theme = preference === 'system' ? (window.matchMedia(${JSON.stringify(darkSchemeQuery)}).matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
  } catch (error) {
    /* A browser that denies storage or media queries keeps the light default the stylesheet ships. */
  }
})();`;
