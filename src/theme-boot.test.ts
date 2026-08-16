import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import viteConfig from '../vite.config';
import { applyTheme, getStoredTheme, themeBootScript } from './theme';

const root = process.cwd();
/** 'midnight' stands for a preference the cycle never writes, so a stale key still resolves. */
const storedPreferences: Array<string | null> = [null, 'system', 'light', 'dark', 'midnight'];

function pretendSystemIsDark(systemIsDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: systemIsDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

/** Runs the boot script exactly as the browser would, before any React code has loaded. */
function bootTheDocument() {
  new Function(themeBootScript)();
}

function paintedTheme() {
  return {
    theme: document.documentElement.dataset.theme,
    colorScheme: document.documentElement.style.colorScheme,
  };
}

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

afterEach(() => {
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
});

describe('theme before the first paint', () => {
  for (const preference of storedPreferences) {
    for (const systemIsDark of [true, false]) {
      const system = systemIsDark ? 'dark' : 'light';
      it(`paints a ${preference ?? 'missing'} preference on a ${system} system the way the app would`, () => {
        if (preference !== null) window.localStorage.setItem('markshare-theme', preference);
        pretendSystemIsDark(systemIsDark);

        bootTheDocument();
        const beforeReact = paintedTheme();

        applyTheme(getStoredTheme(), systemIsDark);
        expect(beforeReact).toEqual(paintedTheme());
      });
    }
  }

  it('reads the same storage key the theme control writes', () => {
    window.localStorage.setItem('markshare-theme', 'dark');
    pretendSystemIsDark(false);

    bootTheDocument();

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('leaves the stylesheet default alone when the browser denies storage', () => {
    pretendSystemIsDark(true);
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage is blocked');
      },
    });

    expect(bootTheDocument).not.toThrow();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('the shipped HTML shell', () => {
  it('never hard-codes a theme for the browser to paint first', () => {
    expect(readFileSync(join(root, 'index.html'), 'utf8')).not.toMatch(/data-theme=/);
  });

  /**
   * Without this the build could stop injecting the script and every other test here would still
   * pass, while the shell shipped with no theme at all — worse than the flash it replaced.
   */
  it('carries the boot script ahead of everything the browser paints', () => {
    const plugins = (viteConfig.plugins ?? []).flat(2) as Plugin[];
    const boot = plugins.find((plugin) => plugin?.name === 'markshare-theme-boot');
    const transform = boot?.transformIndexHtml as (() => HtmlTagDescriptor[]) | undefined;

    expect(transform).toBeTypeOf('function');
    expect(transform?.()).toEqual([{ tag: 'script', children: themeBootScript, injectTo: 'head-prepend' }]);
  });
});
