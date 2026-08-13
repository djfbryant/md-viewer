import DOMPurify from 'dompurify';
import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact, { type Options as RehypeReactOptions } from 'rehype-react';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { Element, Root as HastRoot } from 'hast';
import type { Heading, PhrasingContent, Root as MdastRoot } from 'mdast';

export type InterpretedMarkdown = {
  content: ReactNode;
  download: {
    content: string;
    filename: string;
    mediaType: 'text/markdown;charset=utf-8';
  };
  source: string;
  title: string;
};

function filenameFor(title: string) {
  const withoutControlCharacters = [...title]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('');
  const safeTitle = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  return `${safeTitle || 'Untitled document'}.md`;
}

function headingText(node: PhrasingContent): string {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  if ('children' in node) return node.children.map(headingText).join('');
  return '';
}

function titleFrom(tree: MdastRoot) {
  const heading = tree.children.find(
    (node): node is Heading => node.type === 'heading' && node.depth === 1,
  );
  return heading?.children.map(headingText).join('').trim() || 'Untitled document';
}

function safeUrl(url: string) {
  const colon = url.indexOf(':');
  const relativeMarker = url.search(/[/?#]/);
  if (colon < 0 || (relativeMarker >= 0 && relativeMarker < colon)) return url;

  const protocol = url.slice(0, colon).toLowerCase();
  return ['http', 'https', 'irc', 'ircs', 'mailto', 'xmpp'].includes(protocol) ? url : undefined;
}

function rehypeSafeUrls() {
  return (tree: HastRoot) => {
    const visit = (node: HastRoot | Element) => {
      if (node.type === 'element') {
        for (const property of ['href', 'src'] as const) {
          const value = node.properties[property];
          if (typeof value === 'string' && !safeUrl(value)) delete node.properties[property];
        }
      }
      if ('children' in node) {
        for (const child of node.children) {
          if (child.type === 'element') visit(child);
        }
      }
    };
    visit(tree);
  };
}

let mermaidApiPromise: Promise<typeof import('mermaid')['default']> | undefined;

function getMermaidApi() {
  mermaidApiPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      flowchart: { htmlLabels: false },
      secure: ['securityLevel', 'startOnLoad', 'suppressErrorRendering'],
      securityLevel: 'strict',
      startOnLoad: false,
      suppressErrorRendering: true,
    });
    return mermaid;
  });
  return mermaidApiPromise;
}

function allowsStrictMermaid(source: string) {
  return !/^\s*%%\{/m.test(source)
    && !/^\s*click\s/m.test(source)
    && !/javascript\s*:/i.test(source);
}

type MermaidState =
  | { kind: 'loading' }
  | { kind: 'rendered'; svg: string }
  | { kind: 'invalid' };

export type MermaidGeometry = {
  height: number;
  width: number;
};

export type MermaidSizingDecision = {
  effectiveScale: number;
  effectiveWidth: number;
  lane: 'prose' | 'wide';
  overflows: boolean;
};

export const MERMAID_MINIMUM_SCALE = 0.875;

/**
 * Chooses the least intrusive readable presentation for any SVG-backed Mermaid
 * diagram. This deliberately works from rendered geometry rather than Mermaid
 * source so every diagram type follows the same policy.
 */
export function mermaidSizingDecision(
  geometry: MermaidGeometry | null,
  proseWidth: number,
  wideLaneWidth: number,
): MermaidSizingDecision | null {
  if (!geometry || !Number.isFinite(geometry.width) || geometry.width <= 0
    || !Number.isFinite(proseWidth) || proseWidth <= 0
    || !Number.isFinite(wideLaneWidth) || wideLaneWidth <= 0) return null;

  if (geometry.width <= proseWidth) {
    return { lane: 'prose', effectiveScale: 1, effectiveWidth: geometry.width, overflows: false };
  }

  const proseScale = proseWidth / geometry.width;
  if (proseScale >= MERMAID_MINIMUM_SCALE) {
    return { lane: 'prose', effectiveScale: proseScale, effectiveWidth: proseWidth, overflows: false };
  }

  const effectiveScale = Math.max(MERMAID_MINIMUM_SCALE, Math.min(1, wideLaneWidth / geometry.width));
  const effectiveWidth = geometry.width * effectiveScale;
  return {
    lane: 'wide',
    effectiveScale,
    effectiveWidth,
    overflows: effectiveWidth > wideLaneWidth,
  };
}

function parseSvgGeometry(svg: SVGSVGElement): MermaidGeometry | null {
  const viewBox = svg.getAttribute('viewBox') ?? svg.getAttribute('viewbox');
  if (!viewBox) return null;

  const values = viewBox.trim().split(/[\s,]+/).map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return null;

  // Mermaid sometimes emits CSS dimensions. A valid viewBox is the reliable
  // source of natural SVG geometry, and normalising these attributes keeps the
  // browser's intrinsic ratio stable while CSS applies the chosen scale.
  svg.setAttribute('viewBox', `${x} ${y} ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  if (!svg.hasAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return { width, height };
}

function normalizeMermaidSvg(svg: string) {
  const container = window.document.createElement('div');
  container.innerHTML = svg;
  const renderedSvg = container.querySelector('svg');
  if (renderedSvg instanceof SVGSVGElement) parseSvgGeometry(renderedSvg);
  return container.innerHTML;
}

function measuredWidth(element: HTMLElement | null) {
  if (!element) return 0;
  const rectWidth = element.getBoundingClientRect().width;
  return rectWidth > 0 ? rectWidth : element.clientWidth;
}

function laneWidth(element: HTMLElement | null) {
  if (!element) return 0;
  const width = measuredWidth(element);
  const styles = window.getComputedStyle(element);
  const horizontalPadding = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
  return Math.max(0, width - horizontalPadding);
}

function sameSizingDecision(left: MermaidSizingDecision | null, right: MermaidSizingDecision | null) {
  return left?.lane === right?.lane
    && left?.overflows === right?.overflows
    && left?.effectiveScale === right?.effectiveScale
    && left?.effectiveWidth === right?.effectiveWidth;
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const [state, setState] = useState<MermaidState>({ kind: 'loading' });
  const [sizing, setSizing] = useState<MermaidSizingDecision | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });

    if (!allowsStrictMermaid(source)) {
      setState({ kind: 'invalid' });
      return () => { active = false; };
    }

    void getMermaidApi()
      .then((mermaid) => mermaid.render(`markshare-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, source))
      .then(({ svg }) => {
        const sanitizedSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        if (active) setState({ kind: 'rendered', svg: normalizeMermaidSvg(sanitizedSvg) });
      })
      .catch(() => {
        if (active) setState({ kind: 'invalid' });
      });

    return () => { active = false; };
  }, [reactId, source]);

  useLayoutEffect(() => {
    if (state.kind !== 'rendered') return;

    const frame = frameRef.current;
    const svg = frame?.querySelector('svg');
    if (!frame || !(svg instanceof SVGSVGElement)) return;

    frame.scrollLeft = 0;
    const geometry = parseSvgGeometry(svg);
    const prose = frame.parentElement instanceof HTMLElement ? frame.parentElement : null;
    const wideLane = frame.closest<HTMLElement>('.preview, .reader-content') ?? prose;
    let active = true;

    const updateSizing = () => {
      if (!active) return;
      const next = mermaidSizingDecision(geometry, measuredWidth(prose), laneWidth(wideLane));
      setSizing((current) => sameSizingDecision(current, next) ? current : next);
    };

    setSizing(null);
    updateSizing();

    const observed = [frame, prose, wideLane].filter((element, index, elements): element is HTMLElement =>
      element instanceof HTMLElement && elements.indexOf(element) === index,
    );
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSizing);
      observed.forEach((element) => observer.observe(element));
      return () => {
        active = false;
        observer.disconnect();
      };
    }

    window.addEventListener('resize', updateSizing);
    return () => {
      active = false;
      window.removeEventListener('resize', updateSizing);
    };
  }, [state]);

  if (state.kind === 'rendered') {
    const wide = sizing?.lane === 'wide';
    return <div
      className={`mermaid-diagram${wide ? ' mermaid-diagram--wide' : ''}${sizing?.overflows ? ' mermaid-diagram--overflowing' : ''}`}
      data-mermaid-scale={sizing?.effectiveScale}
      data-mermaid-wide={wide || undefined}
      data-mermaid-overflows={sizing?.overflows || undefined}
      ref={frameRef}
      role="img"
      aria-label="Mermaid diagram"
      style={sizing ? { '--mermaid-rendered-width': `${sizing.effectiveWidth}px` } as React.CSSProperties : undefined}
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />;
  }

  if (state.kind === 'invalid') {
    return <figure className="mermaid-fallback">
      <figcaption>This diagram could not be rendered safely.</figcaption>
      <pre><code className="language-mermaid">{source}</code></pre>
    </figure>;
  }

  return <div className="mermaid-loading" role="status">Rendering diagram…</div>;
}

function mermaidSource(children: ReactNode) {
  const child = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (!child.props.className?.split(' ').includes('language-mermaid')) return null;
  return String(child.props.children ?? '').replace(/\n$/, '');
}

const markdownComponents: NonNullable<RehypeReactOptions['components']> = {
  a({ children, href, ...props }) {
    return href ? <a href={href} {...props}>{children}</a> : <span>{children}</span>;
  },
  pre({ children }) {
    const source = mermaidSource(children);
    return source === null ? <pre>{children}</pre> : <MermaidDiagram source={source} />;
  },
};

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSafeUrls)
  .use(rehypeHighlight, { plainText: ['mermaid'] })
  .use(rehypeReact, { Fragment, components: markdownComponents, jsx, jsxs });

export function interpretMarkdown(source: string): InterpretedMarkdown {
  const tree = markdownProcessor.parse(source) as MdastRoot;
  const title = titleFrom(tree);
  const renderedTree = markdownProcessor.runSync(tree);
  const content = markdownProcessor.stringify(renderedTree) as ReactNode;

  return {
    content,
    download: {
      content: source,
      filename: filenameFor(title),
      mediaType: 'text/markdown;charset=utf-8',
    },
    source,
    title,
  };
}

export function downloadMarkdown(document: InterpretedMarkdown) {
  const blob = new Blob([document.download.content], { type: document.download.mediaType });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.download = document.download.filename;
  link.href = url;
  link.hidden = true;
  window.document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function MarkdownView({ document }: { document: InterpretedMarkdown }) {
  return document.content;
}
