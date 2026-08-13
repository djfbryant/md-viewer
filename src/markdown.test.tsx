import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes('not a diagram')) throw new Error('invalid diagram');
    return { svg: '<svg role="img" aria-label="Rendered Mermaid diagram"></svg>' };
  }),
}));

vi.mock('mermaid', () => ({ default: mermaidApi }));

import { interpretMarkdown, MarkdownView } from './markdown';

afterEach(cleanup);

describe('Markdown interpretation', () => {
  it('derives metadata from the first top-level heading and preserves the source download', () => {
    const source = [
      '```md',
      '# Not the title',
      '```',
      '',
      '> # Not top-level',
      '',
      '# Release *notes* `v2`',
      '',
      '# Later heading',
    ].join('\n');

    const document = interpretMarkdown(source);

    expect(document.title).toBe('Release notes v2');
    expect(document.download).toEqual({
      content: source,
      filename: 'Release notes v2.md',
      mediaType: 'text/markdown;charset=utf-8',
    });
  });

  it('renders GitHub-style tables, task lists, footnotes, and highlighted code', () => {
    const { container } = render(<MarkdownView document={interpretMarkdown([
      '| Item | State |',
      '| --- | --- |',
      '| Release | Ready |',
      '',
      '- [x] Reviewed',
      '',
      'Details.[^details]',
      '',
      '[^details]: Checked by the team.',
      '',
      '```ts',
      'const ready = true;',
      '```',
    ].join('\n'))} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('data-footnote-ref');
    expect(container.querySelector('code.hljs.language-ts')).toHaveTextContent('const ready = true;');
  });

  it('rejects raw HTML and unsafe link protocols', () => {
    const { container } = render(<MarkdownView document={interpretMarkdown([
      '<img src="x" alt="hostile" onerror="alert(1)">',
      '',
      '[Run this](javascript:alert(1))',
    ].join('\n'))} />);

    expect(screen.queryByRole('img', { name: 'hostile' })).not.toBeInTheDocument();
    expect(screen.getByText('Run this')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[onerror]')).toBeNull();
  });

  it('renders Mermaid through the strict policy and falls back safely for invalid diagrams', async () => {
    const valid = render(<MarkdownView document={interpretMarkdown('```mermaid\ngraph TD\nA-->B\n```')} />);

    expect(await screen.findByRole('img', { name: 'Rendered Mermaid diagram' })).toBeInTheDocument();
    expect(mermaidApi.initialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      startOnLoad: false,
    }));
    valid.unmount();

    render(<MarkdownView document={interpretMarkdown('```mermaid\nnot a diagram\n```')} />);
    expect(await screen.findByText('This diagram could not be rendered safely.')).toBeInTheDocument();
    expect(screen.getByText('not a diagram')).toBeInTheDocument();
  });
});
