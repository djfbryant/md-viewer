import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8');

describe('responsive shell contract', () => {
  it('locks page scrolling and defines the two documented breakpoints', () => {
    expect(styles).toContain('html, body, #root { height: 100%; overflow: hidden; }');
    expect(styles).toContain('@media (max-width: 899px)');
    expect(styles).toContain('@media (max-width: 619px)');
  });

  it.each([1920, 1440, 1280, 1024, 900])('keeps the split layout at %ipx', (width) => {
    expect(width).toBeGreaterThanOrEqual(900);
    expect(styles).toContain('.panes { display: grid; grid-template-columns: var(--split, 50%) 7px 1fr;');
  });

  it.each([768, 620, 420, 320])('uses tabs below the split breakpoint at %ipx', (width) => {
    expect(width).toBeLessThan(900);
    expect(styles).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.tabs \{ display: block; \}/);
    expect(styles).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.splitter \{ display: none; \}/);
  });
});
