import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { createDocumentLifecycle } from './document-lifecycle';
import { interpretMarkdown, MarkdownView } from './markdown';
import { createMemoryDocumentStore } from './test/memory-document-store';

const source = [
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
const ORDINARY_FLOWCHART_MARKDOWN = '```mermaid\n' + source + '\n```';

// A real lifecycle over the memory adapter, bound through the same seam production
// binds Instant through — no module mocking.
const flowchartStore = createMemoryDocumentStore();
flowchartStore.addDocument({
  id: 'flowchart-doc',
  title: 'Untitled document',
  markdown: ORDINARY_FLOWCHART_MARKDOWN,
  updatedAt: new Date(),
});
const testLifecycle = createDocumentLifecycle(flowchartStore, () => 'generated-id');

const svgProto = SVGElement.prototype;
const originalGetComputedTextLength = Object.getOwnPropertyDescriptor(svgProto, 'getComputedTextLength');
const originalGetBBox = Object.getOwnPropertyDescriptor(svgProto, 'getBBox');

function installSvgTextMetrics() {
  const textLength = (node: { textContent?: string | null }) => Math.max(1, (node.textContent ?? '').length * 8);

  Object.defineProperty(svgProto, 'getComputedTextLength', {
    configurable: true,
    value() { return textLength(this as { textContent?: string | null }); },
  });
  Object.defineProperty(svgProto, 'getBBox', {
    configurable: true,
    value() {
      const width = textLength(this as { textContent?: string | null });
      return { x: 0, y: 0, width, height: 16 };
    },
  });
}

function restoreSvgTextMetrics() {
  if (originalGetComputedTextLength) Object.defineProperty(svgProto, 'getComputedTextLength', originalGetComputedTextLength);
  else delete (svgProto as { getComputedTextLength?: unknown }).getComputedTextLength;
  if (originalGetBBox) Object.defineProperty(svgProto, 'getBBox', originalGetBBox);
  else delete (svgProto as { getBBox?: unknown }).getBBox;
}

async function expectOrdinaryFlowchart() {
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
}

beforeEach(() => {
  installSvgTextMetrics();
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
  window.history.replaceState({}, '', '/');
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  restoreSvgTextMetrics();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Mermaid real render', () => {
  it('draws an ordinary LR flowchart instead of a safety fallback', async () => {
    render(<MarkdownView document={interpretMarkdown(ORDINARY_FLOWCHART_MARKDOWN)} />);
    await expectOrdinaryFlowchart();
  }, 15_000);

  it('draws that flowchart on a Share Link', async () => {
    window.history.replaceState({}, '', '/s/flowchart-doc');
    render(<App lifecycle={testLifecycle} />);

    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(document.querySelector('.reader-content')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
    await expectOrdinaryFlowchart();
  }, 15_000);

  it('uses display copy, not safety copy, when real Mermaid cannot parse the source', async () => {
    render(<MarkdownView document={interpretMarkdown('```mermaid\nnot a diagram\n```')} />);

    expect(await screen.findByText('This diagram could not be displayed.', undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByText('This diagram could not be rendered safely.')).not.toBeInTheDocument();
    expect(screen.getByText('not a diagram')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Mermaid diagram' })).not.toBeInTheDocument();
  }, 15_000);
});
