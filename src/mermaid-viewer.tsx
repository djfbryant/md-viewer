import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './styles/mermaid-viewer.css';

/** The initial product policy limit: readers may inspect a diagram at up to 400% natural size. */
export const MAX_MERMAID_VIEWER_ZOOM = 4;

const MINIMUM_VIEWPORT_PADDING = 24;

type Point = { x: number; y: number };

type DiagramSize = { height: number; width: number };

export type MermaidViewerProps = {
  /** Whether the overlay is visible. The caller owns this state. */
  open: boolean;
  /** Sanitized Mermaid SVG markup. This component deliberately renders it only once. */
  svg: string;
  /** Called for every supported way of closing the viewer. */
  onClose: () => void;
  /** The expand button to receive focus after closing, when one is available. */
  returnFocusRef?: MutableRefObject<HTMLElement | null>;
  /** A useful label for diagrams whose title is known to the caller. */
  label?: string;
};

type Transform = Point & { scale: number };

type ViewportTransformControls = {
  fit: () => void;
  panBy: (x: number, y: number) => void;
  zoomBy: (factor: number, anchor?: Point) => void;
  zoomTo: (scale: number, anchor?: Point) => void;
};

function svgSize(svg: SVGSVGElement): DiagramSize | null {
  const values = (svg.getAttribute('viewBox') ?? svg.getAttribute('viewbox') ?? '')
    .trim().split(/[\s,]+/).map(Number);
  if (values.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) {
    return { width: values[2], height: values[3] };
  }

  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function fitScaleFor(size: DiagramSize | null, viewport: HTMLElement | null) {
  if (!size || !viewport) return 1;
  const bounds = viewport.getBoundingClientRect();
  const width = Math.max(1, bounds.width - MINIMUM_VIEWPORT_PADDING * 2);
  const height = Math.max(1, bounds.height - MINIMUM_VIEWPORT_PADDING * 2);
  return Math.min(1, width / size.width, height / size.height);
}

function clampTransform(transform: Transform, size: DiagramSize | null, viewport: HTMLElement | null, minimumScale: number): Transform {
  const scale = Math.min(MAX_MERMAID_VIEWER_ZOOM, Math.max(minimumScale, transform.scale));
  if (!size || !viewport) return { ...transform, scale };

  const bounds = viewport.getBoundingClientRect();
  const horizontalReach = Math.max(0, (size.width * scale - bounds.width) / 2);
  const verticalReach = Math.max(0, (size.height * scale - bounds.height) / 2);
  return {
    scale,
    x: Math.min(horizontalReach, Math.max(-horizontalReach, transform.x)),
    y: Math.min(verticalReach, Math.max(-verticalReach, transform.y)),
  };
}

/**
 * A single transform interface used by the viewer's controls and every input
 * method. Keeping the bounds here means a diagram cannot be panned away.
 */
function useViewportTransform(viewportRef: MutableRefObject<HTMLDivElement | null>, size: DiagramSize | null): [Transform, ViewportTransformControls] {
  const [fitScale, setFitScale] = useState(1);
  const [transform, setTransform] = useState<Transform>({ scale: 1, x: 0, y: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;

  const fit = useCallback(() => {
    const nextFitScale = fitScaleFor(sizeRef.current, viewportRef.current);
    fitScaleRef.current = nextFitScale;
    setFitScale(nextFitScale);
    setTransform({ scale: nextFitScale, x: 0, y: 0 });
  }, [viewportRef]);

  const panBy = useCallback((x: number, y: number) => {
    setTransform((current) => clampTransform(
      { ...current, x: current.x + x, y: current.y + y },
      sizeRef.current,
      viewportRef.current,
      fitScaleRef.current,
    ));
  }, [viewportRef]);

  const zoomTo = useCallback((scale: number, anchor: Point = { x: 0, y: 0 }) => {
    setTransform((current) => {
      const ratio = Math.min(MAX_MERMAID_VIEWER_ZOOM, Math.max(fitScaleRef.current, scale)) / current.scale;
      return clampTransform({
        scale,
        x: current.x * ratio + anchor.x * (1 - ratio),
        y: current.y * ratio + anchor.y * (1 - ratio),
      }, sizeRef.current, viewportRef.current, fitScaleRef.current);
    });
  }, [viewportRef]);

  const zoomBy = useCallback((factor: number, anchor?: Point) => {
    setTransform((current) => {
      const scale = current.scale * factor;
      const ratio = Math.min(MAX_MERMAID_VIEWER_ZOOM, Math.max(fitScaleRef.current, scale)) / current.scale;
      return clampTransform({
        scale,
        x: current.x * ratio + (anchor?.x ?? 0) * (1 - ratio),
        y: current.y * ratio + (anchor?.y ?? 0) * (1 - ratio),
      }, sizeRef.current, viewportRef.current, fitScaleRef.current);
    });
  }, [viewportRef]);

  useLayoutEffect(() => {
    fit();
  }, [fit, size]);

  const controls = useMemo(() => ({ fit, panBy, zoomBy, zoomTo }), [fit, panBy, zoomBy, zoomTo]);
  return [transform, controls];
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute('hidden'));
}

function pointForEvent(event: { clientX: number; clientY: number }, viewport: HTMLElement): Point {
  const bounds = viewport.getBoundingClientRect();
  return { x: event.clientX - bounds.left - bounds.width / 2, y: event.clientY - bounds.top - bounds.height / 2 };
}

function distance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function MermaidViewer({ open, svg, onClose, returnFocusRef, label = 'Expanded Mermaid diagram' }: MermaidViewerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pointerPositions = useRef(new Map<number, Point>());
  const lastPointerPoint = useRef<Point | null>(null);
  const [size, setSize] = useState<DiagramSize | null>(null);
  const [transform, controls] = useViewportTransform(viewportRef, size);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const svgElement = viewportRef.current?.querySelector('svg');
    setSize(svgElement instanceof SVGSVGElement ? svgSize(svgElement) : null);
  }, [open, svg]);

  useEffect(() => {
    if (!open) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const resetFit = () => controls.fit();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(resetFit);
    observer?.observe(viewport);
    window.addEventListener('orientationchange', resetFit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('orientationchange', resetFit);
    };
  }, [controls, open]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const body = document.body;
    const root = document.getElementById('root');
    const previousBodyOverflow = body.style.overflow;
    const previousRootAriaHidden = root?.getAttribute('aria-hidden') ?? null;
    const inertRoot = root as (HTMLElement & { inert?: boolean }) | null;
    const previousRootInert = inertRoot?.inert;

    body.style.overflow = 'hidden';
    if (root) {
      root.setAttribute('aria-hidden', 'true');
      if (inertRoot) inertRoot.inert = true;
    }
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      body.style.overflow = previousBodyOverflow;
      if (root) {
        if (previousRootAriaHidden === null) root.removeAttribute('aria-hidden');
        else root.setAttribute('aria-hidden', previousRootAriaHidden);
        if (inertRoot && previousRootInert !== undefined) inertRoot.inert = previousRootInert;
      }
      pointerPositions.current.clear();
      lastPointerPoint.current = null;
      const target = returnFocusRef?.current ?? previousFocusRef.current;
      window.setTimeout(() => target?.focus(), 0);
    };
  }, [open, returnFocusRef]);

  const onWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const isPinch = event.ctrlKey;
    const isMouseWheel = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL || (event.deltaX === 0 && Math.abs(event.deltaY) >= 40);
    event.preventDefault();
    if (isPinch || isMouseWheel) {
      controls.zoomBy(Math.exp(-event.deltaY * 0.01), pointForEvent(event, viewport));
    } else {
      controls.panBy(-event.deltaX, -event.deltaY);
    }
  }, [controls]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!open || !viewport) return;
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [onWheel, open]);

  const onKeyDown = useCallback((event: KeyboardEvent | React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const items = focusableElements(dialog);
      if (!items.length) return;
      const current = document.activeElement;
      const currentIndex = items.indexOf(current as HTMLElement);
      if (currentIndex === -1) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0]?.focus();
      } else if (event.shiftKey && (currentIndex <= 0 || current === dialog)) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (!event.shiftKey && currentIndex === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, select, textarea')) return;
    const panAmount = event.shiftKey ? 80 : 32;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      controls.zoomBy(1.2);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      controls.zoomBy(1 / 1.2);
    } else if (event.key === '0') {
      event.preventDefault();
      controls.fit();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      controls.panBy(panAmount, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      controls.panBy(-panAmount, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      controls.panBy(0, panAmount);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      controls.panBy(0, -panAmount);
    }
  }, [close, controls]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || event.button !== 0) return;
    const point = pointForEvent(event, viewport);
    pointerPositions.current.set(event.pointerId, point);
    lastPointerPoint.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport || !pointerPositions.current.has(event.pointerId)) return;
    const nextPoint = pointForEvent(event, viewport);
    pointerPositions.current.set(event.pointerId, nextPoint);
    const points = [...pointerPositions.current.values()];
    if (points.length >= 2) {
      const first = points[0]!;
      const second = points[1]!;
      const center = midpoint(first, second);
      const previousCenter = lastPointerPoint.current ?? center;
      const previousDistance = (event.currentTarget.dataset.pinchDistance && Number(event.currentTarget.dataset.pinchDistance)) || distance(first, second);
      const nextDistance = distance(first, second);
      controls.zoomBy(nextDistance / Math.max(1, previousDistance), center);
      controls.panBy(center.x - previousCenter.x, center.y - previousCenter.y);
      event.currentTarget.dataset.pinchDistance = String(nextDistance);
      lastPointerPoint.current = center;
    } else {
      const previous = lastPointerPoint.current ?? nextPoint;
      controls.panBy(nextPoint.x - previous.x, nextPoint.y - previous.y);
      lastPointerPoint.current = nextPoint;
    }
  }, [controls]);

  const releasePointer = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    pointerPositions.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    delete event.currentTarget.dataset.pinchDistance;
    const [remaining] = pointerPositions.current.values();
    lastPointerPoint.current = remaining ?? null;
  }, []);

  if (!open || typeof document === 'undefined') return null;

  const zoomPercent = Math.round(transform.scale * 100);
  const content: ReactNode = <div className="mermaid-viewer-backdrop" onPointerDown={(event) => {
    if (event.target === event.currentTarget) close();
  }}>
    <div
      aria-describedby="mermaid-viewer-help"
      aria-label={label}
      aria-modal="true"
      className="mermaid-viewer"
      onKeyDown={onKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <div className="mermaid-viewer__toolbar">
        <p className="mermaid-viewer__title">Diagram viewer</p>
        <div aria-label="Diagram zoom controls" className="mermaid-viewer__controls" role="group">
          <button aria-label="Zoom out" className="button button--small" onClick={() => controls.zoomBy(1 / 1.2)} type="button">−</button>
          <button aria-label="Fit diagram to viewer" className="button button--small" onClick={controls.fit} type="button">Fit</button>
          <button aria-label="Zoom in" className="button button--small" onClick={() => controls.zoomBy(1.2)} type="button">+</button>
          <output aria-label={`Zoom ${zoomPercent}%`} className="mermaid-viewer__zoom">{zoomPercent}%</output>
        </div>
        <button aria-label="Close diagram viewer" className="button button--quiet mermaid-viewer__close" onClick={close} ref={closeButtonRef} type="button">×</button>
      </div>
      <p className="mermaid-viewer__help" id="mermaid-viewer-help">Drag to pan. Use the mouse wheel to zoom, two fingers to pan, pinch to zoom, or use +, −, 0, and the arrow keys.</p>
      <div
        className="mermaid-viewer__viewport"
        onPointerCancel={releasePointer}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={releasePointer}
        ref={viewportRef}
      >
        <div className="mermaid-viewer__diagram" style={{ transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  </div>;

  return createPortal(content, document.body);
}
