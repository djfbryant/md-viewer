export type ThemePreference = 'system' | 'light' | 'dark';

export const themeOrder: ThemePreference[] = ['system', 'light', 'dark'];
export const darkSchemeQuery = '(prefers-color-scheme: dark)';
const storageKey = 'markshare-theme';

function preferenceFromStored(stored: string | null, honoured: readonly string[]): ThemePreference {
  return honoured.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemIsDark ? 'dark' : 'light') : preference;
}

function paintTheme(theme: 'light' | 'dark'): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
}

export function nextTheme(preference: ThemePreference): ThemePreference {
  return themeOrder[(themeOrder.indexOf(preference) + 1) % themeOrder.length];
}

export function getStoredTheme(): ThemePreference {
  return preferenceFromStored(window.localStorage.getItem(storageKey), themeOrder);
}

export function applyTheme(preference: ThemePreference, systemIsDark: boolean): void {
  paintTheme(resolveTheme(preference, systemIsDark));
}

export function storeTheme(preference: ThemePreference): void {
  window.localStorage.setItem(storageKey, preference);
}

/**
 * The first painted frame must already carry the resolved theme, or a dark visitor sees a flash of
 * light chrome on every cold load. This text runs as a blocking inline script ahead of React, so it
 * cannot import. It embeds preferenceFromStored, resolveTheme, and paintTheme themselves. Those
 * functions take every value they need as arguments, so they cannot grow an outer reference. The
 * storage key, the preferences worth honouring, and the media query are interpolated. theme-boot.test.ts
 * then runs this exact text against getStoredTheme plus applyTheme for every preference on both kinds
 * of system, so the answer it paints cannot drift from the answer the app would have reached.
 */
export const themeBootScript = `(function () {
  try {
    ${preferenceFromStored.toString()}
    ${resolveTheme.toString()}
    ${paintTheme.toString()}
    paintTheme(resolveTheme(preferenceFromStored(window.localStorage.getItem(${JSON.stringify(storageKey)}), ${JSON.stringify(themeOrder)}), window.matchMedia(${JSON.stringify(darkSchemeQuery)}).matches));
  } catch (error) {
    /* A browser that denies storage or media queries keeps the light default the stylesheet ships. */
  }
})();`;
