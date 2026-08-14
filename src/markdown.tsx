import DOMPurify from 'dompurify';
import { Children, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import rehypeHighlight from 'rehype-highlight';
import rehypeReact, { type Options as RehypeReactOptions } from 'rehype-react';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import type { Element, Root as HastRoot } from 'hast';
import type { Heading, PhrasingContent, Root as MdastRoot } from 'mdast';
import { isInstantStorageUrl, parseDocumentImageRef } from './document-image';

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
  if (parseDocumentImageRef(url)) return url;
  if (isInstantStorageUrl(url)) return undefined;

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
      htmlLabels: false,
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

export type MermaidExpandRequest = {
  /** Stable presentation ID; lets only the opened diagram yield its live SVG. */
  id: string;
  /** Original Mermaid source, suitable for an editor or source-view panel. */
  source: string;
  /** Sanitized rendered SVG, suitable for an expanded visual viewer. */
  svg: string;
  /** The still-mounted control to restore focus to after closing the viewer. */
  returnFocusRef: MutableRefObject<HTMLButtonElement | null>;
};

export type MermaidExpandHandler = (request: MermaidExpandRequest) => void;

type MermaidOverflowCue = 'none' | 'start' | 'end' | 'both';

type MermaidPresentation = {
  onExpand?: MermaidExpandHandler;
  openMermaidId?: string;
};

const MermaidExpandContext = createContext<MermaidPresentation>({});

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

/**
 * Indicates which edge(s) of an actual native scrolling viewport still contain
 * content. Unlike the sizing decision, this works from browser scroll metrics
 * so faded edges and the hint only appear when content can really be reached.
 */
export function mermaidOverflowCue(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
): MermaidOverflowCue {
  if (!Number.isFinite(scrollLeft) || !Number.isFinite(clientWidth) || !Number.isFinite(scrollWidth)
    || clientWidth <= 0 || scrollWidth <= clientWidth + 1) return 'none';

  const hasMoreBefore = scrollLeft > 1;
  const hasMoreAfter = scrollLeft + clientWidth < scrollWidth - 1;
  if (hasMoreBefore && hasMoreAfter) return 'both';
  return hasMoreBefore ? 'start' : hasMoreAfter ? 'end' : 'none';
}

function overflowHint(cue: MermaidOverflowCue) {
  if (cue === 'start') return 'Scroll left to see the rest of this diagram';
  if (cue === 'end') return 'Scroll right to see the rest of this diagram';
  if (cue === 'both') return 'Scroll horizontally to see more of this diagram';
  return null;
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
  if (!(renderedSvg instanceof SVGSVGElement) || !parseSvgGeometry(renderedSvg)) return null;
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
  const { onExpand: onMermaidExpand, openMermaidId } = useContext(MermaidExpandContext);
  const viewerOpen = openMermaidId === reactId;
  const [state, setState] = useState<MermaidState>({ kind: 'loading' });
  const [sizing, setSizing] = useState<MermaidSizingDecision | null>(null);
  const [overflowCue, setOverflowCue] = useState<MermaidOverflowCue>('none');
  const [overflowHintDismissed, setOverflowHintDismissed] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });
    setOverflowCue('none');
    setOverflowHintDismissed(false);

    if (!allowsStrictMermaid(source)) {
      setState({ kind: 'invalid' });
      return () => { active = false; };
    }

    void getMermaidApi()
      .then((mermaid) => mermaid.render(`markshare-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`, source))
      .then(({ svg }) => {
        const sanitizedSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        const normalizedSvg = normalizeMermaidSvg(sanitizedSvg);
        if (active) setState(normalizedSvg ? { kind: 'rendered', svg: normalizedSvg } : { kind: 'invalid' });
      })
      .catch(() => {
        if (active) setState({ kind: 'invalid' });
      });

    return () => { active = false; };
  }, [reactId, source]);

  useLayoutEffect(() => {
    if (state.kind !== 'rendered' || viewerOpen) return;

    const frame = frameRef.current;
    const svg = frame?.querySelector('svg');
    if (!frame || !(svg instanceof SVGSVGElement)) return;

    frame.scrollLeft = 0;
    const geometry = parseSvgGeometry(svg);
    const prose = frame.closest<HTMLElement>('.markdown')
      ?? (frame.parentElement instanceof HTMLElement ? frame.parentElement : null);
    const wideLane = frame.closest<HTMLElement>('.preview, .reader-content') ?? prose;
    let active = true;

    const updateOverflowCue = () => {
      setOverflowCue(mermaidOverflowCue(frame.scrollLeft, frame.clientWidth, frame.scrollWidth));
    };
    const onScroll = () => {
      if (frame.scrollLeft > 1) setOverflowHintDismissed(true);
      updateOverflowCue();
    };
    const updateSizing = () => {
      if (!active) return;
      const next = mermaidSizingDecision(geometry, measuredWidth(prose), laneWidth(wideLane));
      setSizing((current) => sameSizingDecision(current, next) ? current : next);
      updateOverflowCue();
    };

    setSizing(null);
    updateSizing();
    frame.addEventListener('scroll', onScroll, { passive: true });

    const observed = [frame, prose, wideLane].filter((element, index, elements): element is HTMLElement =>
      element instanceof HTMLElement && elements.indexOf(element) === index,
    );
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateSizing);
      observed.forEach((element) => observer.observe(element));
      return () => {
        active = false;
        observer.disconnect();
        frame.removeEventListener('scroll', onScroll);
      };
    }

    window.addEventListener('resize', updateSizing);
    return () => {
      active = false;
      window.removeEventListener('resize', updateSizing);
      frame.removeEventListener('scroll', onScroll);
    };
  }, [state, viewerOpen]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (state.kind !== 'rendered' || viewerOpen || !frame) return;
    setOverflowCue(mermaidOverflowCue(frame.scrollLeft, frame.clientWidth, frame.scrollWidth));
  }, [sizing, state, viewerOpen]);

  if (state.kind === 'rendered') {
    const wide = sizing?.lane === 'wide';
    const hint = overflowHintDismissed ? null : overflowHint(overflowCue);
    const expandControl = onMermaidExpand && wide && <button
      type="button"
      className="mermaid-diagram__expand"
      aria-label="Open Mermaid diagram in expanded view"
      data-tooltip="Open expanded view"
      title="Open expanded view"
      ref={expandButtonRef}
      onClick={() => onMermaidExpand({ id: reactId, source, svg: state.svg, returnFocusRef: expandButtonRef })}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" focusable="false">
        <path d="M6.25 2.5H2.5v3.75M2.75 2.75l4 4M9.75 2.5h3.75v3.75M13.25 2.75l-4 4M6.25 13.5H2.5V9.75M2.75 13.25l4-4M9.75 13.5h3.75V9.75M13.25 13.25l-4-4" />
      </svg>
    </button>;

    // An expanded viewer renders this same SVG. Keep the origin control
    // mounted for focus restoration, but remove the ID-bearing inline SVG.
    if (viewerOpen) return <figure className="mermaid-diagram" aria-label="Mermaid diagram expanded">
      <figcaption className="mermaid-diagram__toolbar">
        <span className="mermaid-diagram__label">Mermaid diagram</span>
        {expandControl}
      </figcaption>
    </figure>;

    return <figure
      className={`mermaid-diagram${wide ? ' mermaid-diagram--wide' : ''}${sizing?.overflows ? ' mermaid-diagram--overflowing' : ''}`}
      data-mermaid-scale={sizing?.effectiveScale}
      data-mermaid-wide={wide || undefined}
      data-mermaid-overflows={sizing?.overflows || undefined}
      data-mermaid-overflow-cue={overflowCue}
      style={sizing ? { '--mermaid-rendered-width': `${sizing.effectiveWidth}px` } as React.CSSProperties : undefined}
    >
      <figcaption className="mermaid-diagram__toolbar">
        <span className="mermaid-diagram__label">Mermaid diagram</span>
        {hint && <span className="mermaid-diagram__overflow-hint" aria-live="polite">{hint}</span>}
        {expandControl}
      </figcaption>
      <div className="mermaid-diagram__scroll-shell">
        <div
          className="mermaid-diagram__viewport"
          ref={frameRef}
          role="img"
          aria-label="Mermaid diagram"
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      </div>
    </figure>;
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

const DocumentImageContext = createContext<Record<string, string>>({});

function isLocalImageSrc(src: string) {
  return src.startsWith('blob:') || src.startsWith('data:');
}

function usePrivateImageSrc(src: string | undefined, imageId?: string) {
  const [remote, setRemote] = useState<{ id?: string; url?: string }>({});
  const fallback = useRef<{ id?: string; url?: string }>({});

  if (fallback.current.id !== imageId) fallback.current = { id: imageId };
  if (src && isLocalImageSrc(src)) fallback.current = { id: imageId, url: src };

  useEffect(() => {
    if (!src || isLocalImageSrc(src)) {
      setRemote({});
      return;
    }
    setRemote({});
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(src)
      .then((response) => {
        if (!response.ok) throw new Error('unavailable');
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setRemote({ id: imageId, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) setRemote({});
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, imageId]);

  if (!src) return undefined;
  if (isLocalImageSrc(src)) return src;
  return (remote.id === imageId ? remote.url : undefined) ?? fallback.current.url;
}

function MarkdownImage({ alt, src, ...props }: { alt?: string; src?: string } & Record<string, unknown>) {
  const imageSources = useContext(DocumentImageContext);
  const imageId = typeof src === 'string' ? parseDocumentImageRef(src) : undefined;
  const privateSrc = usePrivateImageSrc(imageId ? imageSources[imageId] : undefined, imageId);
  if (imageId) return privateSrc ? <img alt={alt ?? ''} src={privateSrc} {...props} /> : <span>{alt}</span>;
  return src ? <img alt={alt ?? ''} src={src} {...props} /> : <span>{alt}</span>;
}

const markdownComponents: NonNullable<RehypeReactOptions['components']> = {
  a({ children, href, ...props }) {
    return href ? <a href={href} {...props}>{children}</a> : <span>{children}</span>;
  },
  img: MarkdownImage,
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

export function MarkdownView({
  document,
  imageSources,
  onMermaidExpand,
  openMermaidId,
}: {
  document: InterpretedMarkdown;
  /** Capability-resolved document image sources; never Instant file URLs from Markdown. */
  imageSources?: Record<string, string>;
  /** Connect this to a viewer/dialog if expanded diagrams should be available. */
  onMermaidExpand?: MermaidExpandHandler;
  /**
   * Set to the opened diagram's ID while the parent renders its expanded
   * viewer. Only that inline SVG is removed, so other diagrams remain intact.
   */
  openMermaidId?: string;
}) {
  return <DocumentImageContext.Provider value={imageSources ?? {}}>
    <MermaidExpandContext.Provider value={{ onExpand: onMermaidExpand, openMermaidId }}>{document.content}</MermaidExpandContext.Provider>
  </DocumentImageContext.Provider>;
}
