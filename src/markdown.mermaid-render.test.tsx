import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { interpretMarkdown, MarkdownView } from './markdown';

const ORDINARY_FLOWCHART = [
  'flowchart LR',
  '    A[User] --> B{Intent?}',
  '    B -->|Code| C[Editor]',
  '    B -->|Chat| D[Composer]',
  '    B -->|Agent| E[Cursor Agent]',
  '    C --> F[LSP]',
  '    D --> G[Context]',
  '    E --> H[Tools]',
  '    F --> I[Model]',
  '    G --> I',
  '    H --> I',
  '    I --> J[Apply]',
  '    J --> K[Review]',
  '    K -->|Accept| L[Done]',
  '    K -->|Reject| M[Retry]',
  '    M --> E',
].join('\n');

function installSvgTextMetrics() {
  const textLength = (node: { textContent?: string | null }) => Math.max(1, (node.textContent ?? '').length * 8);
  const prototype = SVGElement.prototype;

  if (!('getComputedTextLength' in prototype)) {
    Object.defineProperty(prototype, 'getComputedTextLength', {
      configurable: true,
      value() { return textLength(this as { textContent?: string | null }); },
    });
  }
  if (!('getBBox' in prototype)) {
    Object.defineProperty(prototype, 'getBBox', {
      configurable: true,
      value() {
        const width = textLength(this as { textContent?: string | null });
        return { x: 0, y: 0, width, height: 16 };
      },
    });
  }
}

beforeEach(() => {
  installSvgTextMetrics();
});

afterEach(() => {
  cleanup();
});

describe('Mermaid real render', () => {
  it('draws an ordinary LR flowchart instead of a safety fallback', async () => {
    render(<MarkdownView document={interpretMarkdown(`\`\`\`mermaid\n${ORDINARY_FLOWCHART}\n\`\`\``)} />);

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' }, { timeout: 10_000 });
    const svg = diagram.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(screen.queryByText('This diagram could not be rendered safely.')).not.toBeInTheDocument();
    expect(screen.queryByText('This diagram could not be displayed.')).not.toBeInTheDocument();

    const viewBox = svg!.getAttribute('viewBox') ?? '';
    const [, , width, height] = viewBox.trim().split(/[\s,]+/).map(Number);
    expect(width).toBeGreaterThan(100);
    expect(height).toBeGreaterThan(20);
    expect(diagram.textContent).toContain('User');
    expect(diagram.textContent).toContain('Intent?');
    expect(diagram.textContent).toContain('Cursor Agent');
  }, 15_000);
});
