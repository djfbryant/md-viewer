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

  it('shows About, Privacy, and Acceptable use on the home page', () => {
    render(<App />);
    expect(screen.getAllByRole('link', { name: 'About' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Privacy' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Acceptable use' }).length).toBeGreaterThan(0);
  });

  it('opens About, Privacy, and Acceptable use from the home page', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('link', { name: 'About' })[0]);
    expect(screen.getByRole('heading', { name: 'About MarkShare' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/about');

    fireEvent.click(screen.getAllByRole('link', { name: 'Privacy' })[0]);
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.getByText(/no account/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('link', { name: 'Acceptable use' })[0]);
    expect(screen.getByRole('heading', { name: 'Acceptable use' })).toBeInTheDocument();
    expect(screen.getByText(/do not use MarkShare for illegal/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to markshare home/i }));
    expect(screen.getByRole('heading', { name: /write clearly/i })).toBeInTheDocument();
  });

  it('loads a public information page from its URL', () => {
    window.history.replaceState({}, '', '/privacy');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create a document/i })).not.toBeInTheDocument();
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
