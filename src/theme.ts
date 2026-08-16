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
 * cannot import: the storage names are interpolated from the constants above and the resolve rule is
 * serialised from resolveTheme itself, which is why that function must stay free of outer references.
 * theme-boot.test.ts runs this exact text and pins its outcome to getStoredTheme plus resolveTheme.
 */
export const themeBootScript = `(function () {
  try {
    var order = ${JSON.stringify(themeOrder)};
    var resolveTheme = ${resolveTheme.toString()};
    var stored = window.localStorage.getItem(${JSON.stringify(storageKey)});
    var preference = order.indexOf(stored) >= 0 ? stored : 'system';
    var theme = resolveTheme(preference, window.matchMedia(${JSON.stringify(darkSchemeQuery)}).matches);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (unavailable) {
    /* A browser that denies storage or media queries keeps the light default the stylesheet ships. */
  }
})();`;
