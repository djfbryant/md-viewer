import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const appStyles = readFileSync(join(process.cwd(), 'src/styles/app.css'), 'utf8');
const markdown = readFileSync(join(process.cwd(), 'src/markdown.tsx'), 'utf8');
const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const sans = tokens.match(/--sans:\s*([^;]+);/)?.[1];

describe('Mermaid theme contract', () => {
  it('keeps diagram labels on the document sans stack', () => {
    expect(sans).toContain('Inter');
    expect(markdown).toContain(`const MERMAID_FONT_FAMILY = "${sans}"`);
    expect(appStyles).toContain(':is(.mermaid-diagram, .mermaid-viewer)');
    expect(appStyles).toContain('font-family: var(--sans) !important');
  });

  it('applies dark-theme fills to subgraphs and the expanded viewer', () => {
    expect(appStyles).toMatch(
      /\[data-theme='dark'\] :is\(\.mermaid-diagram, \.mermaid-viewer\) svg[\s\S]*\.cluster rect/,
    );
    expect(appStyles).toMatch(
      /\[data-theme='dark'\] :is\(\.mermaid-diagram, \.mermaid-viewer\) svg[\s\S]*fill: var\(--surface-2\) !important/,
    );
  });
});
