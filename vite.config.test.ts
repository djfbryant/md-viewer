import { describe, expect, it } from 'vitest';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import viteConfig from './vite.config';
import { themeBootScript } from './src/theme.ts';

describe('the shipped HTML shell', () => {
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
