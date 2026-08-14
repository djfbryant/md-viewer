import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { MAX_MERMAID_VIEWER_ZOOM, MermaidViewer } from './mermaid-viewer';

const diagram = '<svg viewBox="0 0 1000 400" aria-label="A diagram"><defs><marker id="arrow" /></defs><path marker-end="url(#arrow)" /></svg>';

beforeEach(() => {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('mermaid-viewer__viewport')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 300, width: 500, height: 300, toJSON: () => ({}) };
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  });
});

afterEach(() => {
  cleanup();
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function ViewerHarness({ svg = diagram }: { svg?: string }) {
  const [open, setOpen] = useState(true);
  const expandRef = useRef<HTMLButtonElement>(null);
  return <>
    <button onClick={() => setOpen(true)} ref={expandRef} type="button">Expand diagram</button>
    <MermaidViewer onClose={() => setOpen(false)} open={open} returnFocusRef={expandRef} svg={svg} />
  </>;
}

describe('MermaidViewer', () => {
  it('renders one labelled SVG presentation and starts in Fit mode', () => {
    render(<ViewerHarness />);

    expect(screen.getByRole('dialog', { name: 'Expanded Mermaid diagram' })).toBeInTheDocument();
    expect(document.querySelectorAll('.mermaid-viewer svg')).toHaveLength(1);
    expect(screen.getByLabelText('Zoom 45%')).toBeInTheDocument();
  });

  it('bounds visible zoom controls and keyboard shortcuts by the named 400% maximum', () => {
    render(<ViewerHarness />);
    const dialog = screen.getByRole('dialog');
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomIn);
    expect(screen.getByLabelText('Zoom 400%')).toBeInTheDocument();
    expect(MAX_MERMAID_VIEWER_ZOOM).toBe(4);

    fireEvent.keyDown(dialog, { key: '0' });
    expect(screen.getByLabelText('Zoom 45%')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: '+' });
    expect(screen.getByLabelText('Zoom 54%')).toBeInTheDocument();
  });

  it('supports wheel zoom while retaining the transform inside the viewer', () => {
    render(<ViewerHarness />);
    const viewport = document.querySelector<HTMLElement>('.mermaid-viewer__viewport')!;
    const event = new WheelEvent('wheel', { cancelable: true });
    Object.defineProperties(event, {
      deltaMode: { value: WheelEvent.DOM_DELTA_LINE },
      deltaY: { value: -3 },
    });
    act(() => viewport.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByLabelText('Zoom 47%')).toBeInTheDocument();
  });

  it('closes through the backdrop and Escape, but never for a pointer action inside the dialog', () => {
    const close = vi.fn();
    render(<MermaidViewer onClose={close} open svg={diagram} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.pointerDown(dialog);
    expect(close).not.toHaveBeenCalled();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(document.querySelector('.mermaid-viewer-backdrop')!);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('locks the background and restores focus to the originating expand control after close', async () => {
    render(<ViewerHarness />);
    const origin = screen.getByRole('button', { name: 'Expand diagram' });
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.getElementById('root')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Close diagram viewer' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(origin).toHaveFocus());
    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('root')).not.toHaveAttribute('aria-hidden');
  });

  it('resets to Fit whenever the rendered SVG changes', () => {
    const rendered = render(<ViewerHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom 54%')).toBeInTheDocument();

    rendered.rerender(<ViewerHarness svg={'<svg viewBox="0 0 400 100"></svg>'} />);
    expect(screen.getByLabelText('Zoom 100%')).toBeInTheDocument();
  });

  it('keeps one ResizeObserver while a resize refits the diagram', async () => {
    const observers: Array<{ callback: ResizeObserverCallback }> = [];
    class ResizeObserverMock {
      callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);

    render(<ViewerHarness />);
    await waitFor(() => expect(observers).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom 54%')).toBeInTheDocument();

    act(() => observers[0]?.callback([], observers[0] as unknown as ResizeObserver));

    expect(screen.getByLabelText('Zoom 45%')).toBeInTheDocument();
    expect(observers).toHaveLength(1);
  });

  it('cleans up its document state when unmounted while open', () => {
    const rendered = render(<MermaidViewer onClose={vi.fn()} open svg={diagram} />);
    rendered.unmount();
    act(() => {});
    expect(document.body.style.overflow).toBe('');
    expect(document.getElementById('root')).not.toHaveAttribute('aria-hidden');
  });
});
