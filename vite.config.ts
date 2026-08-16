import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { themeBootScript } from './src/theme.ts';

/**
 * Puts the resolved theme on <html> before the browser paints anything. The shell cannot hard-code a
 * theme without flashing it at the visitors who chose the other one, so the answer is injected here
 * instead of written into index.html, and stays the single copy that lives in src/theme.ts.
 */
export const themeBoot = (): Plugin => ({
  name: 'markshare-theme-boot',
  transformIndexHtml: () => [{ tag: 'script', children: themeBootScript, injectTo: 'head-prepend' }],
});

export default defineConfig({
  appType: 'spa',
  plugins: [react(), themeBoot()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    setupFiles: './src/test/setup.ts',
  },
});
