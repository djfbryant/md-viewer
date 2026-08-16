import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyTheme, getStoredTheme, nextTheme, storeTheme, type ThemePreference } from './theme';

type ThemeControl = { preference: ThemePreference; cycle: () => void };

const ThemeContext = createContext<ThemeControl | null>(null);

function useThemeControl(): ThemeControl {
  const control = useContext(ThemeContext);
  if (!control) throw new Error('ThemeButton needs a ThemeProvider above it.');
  return control;
}

/**
 * Owns the single browser-wide theme preference. Every surface reads it from here, so a reader
 * on a share link gets the same control as the author, and neither can drift from the other.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => getStoredTheme());
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    media.addEventListener('change', followSystem);
    return () => media.removeEventListener('change', followSystem);
  }, []);

  useEffect(() => applyTheme(preference, systemIsDark), [preference, systemIsDark]);

  const control = useMemo<ThemeControl>(() => ({
    preference,
    cycle: () => {
      const next = nextTheme(preference);
      storeTheme(next);
      setPreference(next);
    },
  }), [preference]);

  return <ThemeContext.Provider value={control}>{children}</ThemeContext.Provider>;
}

export function ThemeButton() {
  const { preference, cycle } = useThemeControl();
  const symbol = preference === 'system' ? '◐' : preference === 'light' ? '☀' : '☾';
  return (
    <button className="button button--quiet button--small" onClick={cycle} aria-label={`Theme: ${preference}. Change theme`} title={`Theme: ${preference}`}>
      <span aria-hidden="true">{symbol}</span>
    </button>
  );
}
