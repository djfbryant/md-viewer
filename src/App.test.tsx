import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

beforeEach(() => {
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

afterEach(cleanup);

describe('MarkShare shell', () => {
  it('starts a document from the home page', () => {
    window.history.replaceState({}, '', '/');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /create a document/i }));
    expect(screen.getByRole('textbox', { name: /markdown document/i })).toBeInTheDocument();
    expect(screen.getByText('Your preview will appear here')).toBeInTheDocument();
  });

  it('does not open the editor for an unknown path', () => {
    window.history.replaceState({}, '', '/not-a-document');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Document unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /markdown document/i })).not.toBeInTheDocument();
  });

  it('persists the theme preference when the control is cycled', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /theme: system/i }));
    expect(window.localStorage.getItem('markshare-theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
