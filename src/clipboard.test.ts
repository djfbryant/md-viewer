import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './clipboard';

function stubClipboard(clipboard: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('copyToClipboard', () => {
  it('puts the exact text on the clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard({ writeText });

    await expect(copyToClipboard('http://localhost/s/opaque-document-id')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('http://localhost/s/opaque-document-id');
  });

  it('reports failure when the browser refuses permission', async () => {
    stubClipboard({ writeText: vi.fn(async () => { throw new Error('denied'); }) });

    await expect(copyToClipboard('anything')).resolves.toBe(false);
  });

  it('reports failure when the browser has no clipboard', async () => {
    stubClipboard(undefined);

    await expect(copyToClipboard('anything')).resolves.toBe(false);
  });
});
