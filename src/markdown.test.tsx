import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mermaidApi = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, source: string) => {
    if (source.includes('not a diagram')) throw new Error('invalid diagram');
    if (source.includes('unsafe output')) return { svg: '<svg role="img" viewBox="0 0 100 100" onload="alert(1)"><script>alert(1)</script><a href="javascript:alert(1)">Bad</a></svg>' };
    if (source.includes('malformed geometry')) return { svg: '<svg role="img" viewBox="0 0 0 200"></svg>' };
    if (source.includes('sized diagram')) return { svg: '<svg role="img" viewBox="0 0 1200 300"></svg>' };
    if (source.includes('replacement diagram')) return { svg: '<svg role="img" viewBox="0 0 400 100"></svg>' };
    return { svg: '<svg role="img" aria-label="Rendered Mermaid diagram" viewBox="0 0 100 100"></svg>' };
  }),
}));

vi.mock('mermaid', () => ({ default: mermaidApi }));

import { interpretMarkdown, MarkdownView, mermaidOverflowCue, mermaidSizingDecision } from './markdown';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let widthFor: (element: Element) => number = () => 0;

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const width = widthFor(this);
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  widthFor = () => 0;
});

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
    expect(interpretMarkdown('# Hello <b>world</b>').title).toBe('Hello world');
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

  it('renders document-scoped images only when capability-resolved sources are provided', () => {
    const source = '![Dashboard sketch](markshare-image:pasted-image)';
    const unresolved = render(<MarkdownView document={interpretMarkdown(source)} />);
    expect(unresolved.container.querySelector('img')).toBeNull();
    expect(unresolved.getByText('Dashboard sketch')).toBeInTheDocument();
    expect(interpretMarkdown(source).download.content).toBe(source);
    unresolved.unmount();

    const { container } = render(<MarkdownView
      document={interpretMarkdown(source)}
      imageSources={{ 'pasted-image': 'blob:document-image' }}
    />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'blob:document-image');
    expect(container.querySelector('img')).toHaveAttribute('alt', 'Dashboard sketch');
  });

  it('does not render Instant storage URLs as an alternative image seam', () => {
    const leaked = render(<MarkdownView document={interpretMarkdown(
      '![leaked](https://instant-storage.s3.amazonaws.com/apps/secret/photo.png)',
    )} />);
    expect(leaked.container.querySelector('img')).toBeNull();
    expect(screen.getByText('leaked')).toBeInTheDocument();
    leaked.unmount();

    const protocolRelative = render(<MarkdownView document={interpretMarkdown(
      '![leaked](//instant-storage.s3.amazonaws.com/apps/secret/photo.png)',
    )} />);
    expect(protocolRelative.container.querySelector('img')).toBeNull();
    expect(screen.getByText('leaked')).toBeInTheDocument();
    protocolRelative.unmount();

    const { container } = render(<MarkdownView document={interpretMarkdown(
      '![safe remote](https://cdn.example.com/photo.png)',
    )} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/photo.png');
  });

  it('does not put Instant storage URLs on rendered document images', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resolved-document-image');

    render(<MarkdownView
      document={interpretMarkdown('![secret](markshare-image:pasted-image)')}
      imageSources={{ 'pasted-image': 'https://instant-storage.s3.amazonaws.com/apps/secret/photo.png' }}
    />);

    expect(await screen.findByRole('img', { name: 'secret' })).toHaveAttribute('src', 'blob:resolved-document-image');
    expect(fetch).toHaveBeenCalledWith('https://instant-storage.s3.amazonaws.com/apps/secret/photo.png');
  });

  it('keeps a local preview visible while a stored Instant URL is fetched', async () => {
    const document = interpretMarkdown('![sketch.png](markshare-image:pasted-image)');
    const { rerender } = render(<MarkdownView
      document={document}
      imageSources={{ 'pasted-image': 'blob:pasted-preview' }}
    />);
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');

    let complete: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      complete = resolve;
    })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:resolved-document-image');

    rerender(<MarkdownView
      document={document}
      imageSources={{ 'pasted-image': 'https://instant-storage.s3.amazonaws.com/apps/secret/photo.png' }}
    />);
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');

    complete(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } }));
    expect(await screen.findByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:resolved-document-image');
  });

  it('keeps a local preview when fetching the stored Instant URL fails', async () => {
    const document = interpretMarkdown('![sketch.png](markshare-image:pasted-image)');
    const { rerender } = render(<MarkdownView
      document={document}
      imageSources={{ 'pasted-image': 'blob:pasted-preview' }}
    />);

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    rerender(<MarkdownView
      document={document}
      imageSources={{ 'pasted-image': 'https://instant-storage.s3.amazonaws.com/apps/secret/photo.png' }}
    />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('https://instant-storage.s3.amazonaws.com/apps/secret/photo.png');
    });
    expect(screen.getByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:pasted-preview');
  });

  it('does not show a previous image preview when the slot changes image id', () => {
    const first = interpretMarkdown('![a.png](markshare-image:img-1)');
    const { rerender } = render(<MarkdownView
      document={first}
      imageSources={{ 'img-1': 'blob:preview-1' }}
    />);
    expect(screen.getByRole('img', { name: 'a.png' })).toHaveAttribute('src', 'blob:preview-1');

    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const second = interpretMarkdown('![b.png](markshare-image:img-2)');
    rerender(<MarkdownView
      document={second}
      imageSources={{ 'img-2': 'https://instant-storage.s3.amazonaws.com/apps/secret/b.png' }}
    />);

    expect(screen.queryByRole('img', { name: 'a.png' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'b.png' })?.getAttribute('src')).not.toBe('blob:preview-1');
  });

  it('does not show a previous fetched image when the slot changes image id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:fetched-a').mockReturnValue('blob:fetched-b');
    const first = interpretMarkdown('![a.png](markshare-image:img-1)');
    const { rerender } = render(<MarkdownView
      document={first}
      imageSources={{ 'img-1': 'https://instant-storage.s3.amazonaws.com/apps/secret/a.png' }}
    />);
    expect(await screen.findByRole('img', { name: 'a.png' })).toHaveAttribute('src', 'blob:fetched-a');

    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const second = interpretMarkdown('![b.png](markshare-image:img-2)');
    rerender(<MarkdownView
      document={second}
      imageSources={{ 'img-2': 'https://instant-storage.s3.amazonaws.com/apps/secret/b.png' }}
    />);
    expect(screen.queryByRole('img', { name: 'b.png' })?.getAttribute('src')).not.toBe('blob:fetched-a');
  });

  it('does not keep a revoked object URL when the stored Instant URL changes', async () => {
    const document = interpretMarkdown('![sketch.png](markshare-image:img-1)');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/png' } })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:obj-1').mockReturnValue('blob:obj-2');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { rerender } = render(<MarkdownView
      document={document}
      imageSources={{ 'img-1': 'https://instant-storage.s3.amazonaws.com/apps/secret/a.png?sig=1' }}
    />);
    expect(await screen.findByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:obj-1');

    let complete: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      complete = resolve;
    })));
    rerender(<MarkdownView
      document={document}
      imageSources={{ 'img-1': 'https://instant-storage.s3.amazonaws.com/apps/secret/a.png?sig=2' }}
    />);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:obj-1');
    expect(screen.queryByRole('img', { name: 'sketch.png' })?.getAttribute('src')).not.toBe('blob:obj-1');

    complete(new Response(new Uint8Array([2]), { headers: { 'Content-Type': 'image/png' } }));
    expect(await screen.findByRole('img', { name: 'sketch.png' })).toHaveAttribute('src', 'blob:obj-2');
  });

  it('renders Mermaid through the strict policy and falls back safely for invalid diagrams', async () => {
    const valid = render(<MarkdownView document={interpretMarkdown('```mermaid\ngraph TD\nA-->B\n```')} />);

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    expect(mermaidApi.initialize).toHaveBeenCalledWith(expect.objectContaining({
      htmlLabels: false,
      securityLevel: 'strict',
      startOnLoad: false,
    }));
    valid.unmount();

    render(<MarkdownView document={interpretMarkdown('```mermaid\nnot a diagram\n```')} />);
    expect(await screen.findByText('This diagram could not be rendered safely.')).toBeInTheDocument();
    expect(screen.getByText('not a diagram')).toBeInTheDocument();
  });

  it('falls back safely when sanitized Mermaid output has no usable geometry', async () => {
    render(<MarkdownView document={interpretMarkdown('```mermaid\nmalformed geometry\n```')} />);

    expect(await screen.findByText('This diagram could not be rendered safely.')).toBeInTheDocument();
    expect(screen.getByText('malformed geometry')).toBeInTheDocument();
  });

  it('rejects interactive Mermaid input and sanitizes renderer output', async () => {
    mermaidApi.render.mockClear();
    const hostileSource = [
      '```mermaid',
      '%%{init: {"securityLevel": "loose"}}%%',
      'graph TD',
      'click A "javascript:alert(1)"',
      '```',
    ].join('\n');
    const hostile = render(<MarkdownView document={interpretMarkdown(hostileSource)} />);

    expect(await screen.findByText('This diagram could not be rendered safely.')).toBeInTheDocument();
    expect(mermaidApi.render).not.toHaveBeenCalled();
    hostile.unmount();

    const output = render(<MarkdownView document={interpretMarkdown('```mermaid\nunsafe output\n```')} />);
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    expect(output.container.querySelector('script')).toBeNull();
    expect(output.container.querySelector('[onload]')).toBeNull();
    expect(output.container.innerHTML).not.toContain('javascript:');
  });

  it('chooses prose, wide-lane, and readable overflowing sizes from SVG geometry', () => {
    expect(mermaidSizingDecision({ width: 500, height: 100 }, 600, 900)).toEqual({
      lane: 'prose', effectiveScale: 1, effectiveWidth: 500, overflows: false,
    });
    expect(mermaidSizingDecision({ width: 800, height: 100 }, 600, 900)).toEqual({
      lane: 'wide', effectiveScale: 1, effectiveWidth: 800, overflows: false,
    });
    expect(mermaidSizingDecision({ width: 1400, height: 100 }, 600, 1000)).toEqual({
      lane: 'wide', effectiveScale: 0.875, effectiveWidth: 1225, overflows: true,
    });
    expect(mermaidSizingDecision({ width: 0, height: 100 }, 600, 900)).toBeNull();
  });

  it('describes only the native scroll edges that still contain diagram content', () => {
    expect(mermaidOverflowCue(0, 600, 600)).toBe('none');
    expect(mermaidOverflowCue(0, 600, 1000)).toBe('end');
    expect(mermaidOverflowCue(150, 600, 1000)).toBe('both');
    expect(mermaidOverflowCue(400, 600, 1000)).toBe('start');
  });

  it('normalizes rendered SVG geometry, recomputes on resize, and cleans up its observer', async () => {
    let proseWidth = 600;
    const laneWidth = 1000;
    widthFor = (element) => {
      if (element.classList.contains('markdown')) return proseWidth;
      if (element.classList.contains('preview')) return laneWidth;
      return 0;
    };
    const source = '```mermaid\nsized diagram\n```';
    const rendered = render(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown(source)} /></article></div>);

    const diagram = await screen.findByRole('img', { name: 'Mermaid diagram' }).then((svg) => svg.closest('.mermaid-diagram')!);
    const svg = diagram.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 1200 300');
    expect(svg).toHaveAttribute('width', '1200');
    expect(svg).toHaveAttribute('height', '300');
    await waitFor(() => {
      expect(diagram).toHaveAttribute('data-mermaid-wide', 'true');
      expect(diagram).toHaveAttribute('data-mermaid-overflows', 'true');
      expect(diagram).toHaveStyle({ '--mermaid-rendered-width': '1050px' });
    });

    proseWidth = 1300;
    act(() => ResizeObserverMock.instances.forEach((observer) => observer.trigger()));
    expect(diagram).not.toHaveAttribute('data-mermaid-wide');
    expect(diagram).toHaveStyle({ '--mermaid-rendered-width': '1200px' });

    rendered.unmount();
    expect(ResizeObserverMock.instances.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });

  it('resets sizing when changed Mermaid source produces a new SVG', async () => {
    let proseWidth = 600;
    widthFor = (element) => element.classList.contains('markdown') ? proseWidth : 1000;
    const rendered = render(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown('```mermaid\nsized diagram\n```')} /></article></div>);

    expect((await screen.findByRole('img', { name: 'Mermaid diagram' })).closest('.mermaid-diagram')).toHaveAttribute('data-mermaid-wide', 'true');
    proseWidth = 600;
    rendered.rerender(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown('```mermaid\nreplacement diagram\n```')} /></article></div>);

    const replacement = await screen.findByRole('img', { name: 'Mermaid diagram' }).then((svg) => svg.closest('.mermaid-diagram')!);
    expect(replacement).not.toHaveAttribute('data-mermaid-wide');
    expect(replacement).toHaveStyle({ '--mermaid-rendered-width': '400px' });
  });

  it('shows accurate native overflow cues and resets them for a replacement diagram', async () => {
    widthFor = (element) => element.classList.contains('markdown') ? 600 : 1000;
    const source = '```mermaid\nsized diagram\n```';
    const rendered = render(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown(source)} /></article></div>);
    const viewport = await screen.findByRole('img', { name: 'Mermaid diagram' });
    let scrollLeft = 0;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, get: () => 600 },
      scrollWidth: { configurable: true, get: () => 1050 },
      scrollLeft: { configurable: true, get: () => scrollLeft, set: (value) => { scrollLeft = value; } },
    });

    act(() => ResizeObserverMock.instances.forEach((observer) => observer.trigger()));
    const panel = viewport.closest('.mermaid-diagram');
    expect(panel).toHaveAttribute('data-mermaid-overflow-cue', 'end');
    expect(screen.getByText('Scroll right to see the rest of this diagram')).toBeInTheDocument();

    scrollLeft = 200;
    fireEvent.scroll(viewport);
    expect(panel).toHaveAttribute('data-mermaid-overflow-cue', 'both');
    expect(screen.queryByText(/Scroll (left|right|horizontally) to see/)).toBeNull();

    scrollLeft = 450;
    fireEvent.scroll(viewport);
    expect(panel).toHaveAttribute('data-mermaid-overflow-cue', 'start');

    rendered.rerender(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown('```mermaid\nreplacement diagram\n```')} /></article></div>);
    const replacement = await screen.findByRole('img', { name: 'Mermaid diagram' });
    expect(replacement.closest('.mermaid-diagram')).toHaveAttribute('data-mermaid-overflow-cue', 'none');
    expect(screen.queryByText(/Scroll (left|right|horizontally) to see/)).toBeNull();
  });

  it('provides an accessible expanded-view control and removes inline SVG while its viewer is open', async () => {
    const onMermaidExpand = vi.fn();
    const document = interpretMarkdown('```mermaid\nsized diagram\n```');
    widthFor = (element) => element.classList.contains('markdown') ? 600 : 1000;
    const rendered = render(<div className="preview"><article className="markdown"><MarkdownView document={document} onMermaidExpand={onMermaidExpand} /></article></div>);

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    const expand = screen.getByRole('button', { name: 'Open Mermaid diagram in expanded view' });
    expect(expand).toHaveAttribute('title', 'Open expanded view');
    expect(expand).toHaveAttribute('data-tooltip', 'Open expanded view');
    fireEvent.click(expand);
    expect(onMermaidExpand).toHaveBeenCalledWith(expect.objectContaining({
      source: 'sized diagram',
      svg: expect.stringContaining('viewBox="0 0 1200 300"'),
    }));

    const openedDiagram = onMermaidExpand.mock.calls[0]?.[0];
    rendered.rerender(<div className="preview"><article className="markdown"><MarkdownView document={document} onMermaidExpand={onMermaidExpand} openMermaidId={openedDiagram.id} /></article></div>);
    expect(screen.queryByRole('img', { name: 'Mermaid diagram' })).toBeNull();
    expect(rendered.container.querySelector('.mermaid-diagram__viewport svg')).toBeNull();
  });

  it('keeps fitting diagrams free of expanded-view controls', async () => {
    widthFor = (element) => element.classList.contains('markdown') ? 1400 : 1600;
    render(<div className="preview"><article className="markdown"><MarkdownView document={interpretMarkdown('```mermaid\nreplacement diagram\n```')} onMermaidExpand={vi.fn()} /></article></div>);

    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open Mermaid diagram in expanded view' })).toBeNull();
  });

  it('keeps unrelated diagrams rendered while one is open in the viewer', async () => {
    widthFor = (element) => element.classList.contains('markdown') ? 600 : 1000;
    const onMermaidExpand = vi.fn();
    const document = interpretMarkdown('```mermaid\nsized diagram\n```\n\n```mermaid\nsized diagram\n```');
    const rendered = render(<div className="preview"><article className="markdown"><MarkdownView document={document} onMermaidExpand={onMermaidExpand} /></article></div>);

    const expandControls = await screen.findAllByRole('button', { name: 'Open Mermaid diagram in expanded view' });
    fireEvent.click(expandControls[0]!);
    const openedDiagram = onMermaidExpand.mock.calls[0]?.[0];
    rendered.rerender(<div className="preview"><article className="markdown"><MarkdownView document={document} onMermaidExpand={onMermaidExpand} openMermaidId={openedDiagram.id} /></article></div>);

    expect(screen.getAllByRole('img', { name: 'Mermaid diagram' })).toHaveLength(1);
    expect(rendered.container.querySelectorAll('.mermaid-diagram__viewport svg')).toHaveLength(1);
  });
});
