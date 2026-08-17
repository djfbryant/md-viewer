import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { handleScheduledCleanup } from './scheduled-cleanup';

describe('scheduled cleanup transport', () => {
  it('rejects requests that are not the Vercel cron invocation', async () => {
    const cleanup = vi.fn();
    await expect(handleScheduledCleanup({ headers: { get: () => null } }, cleanup, 'cron-secret')).resolves.toEqual({
      status: 401,
      body: { error: 'unauthorized' },
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it('runs cleanup for an authorized cron request and reports counts rather than document details', async () => {
    const cleanup = vi.fn(async () => ({
      kind: 'cleaned' as const,
      removed: [
        { documentId: 'expired-id', imageCount: 2 },
        { documentId: 'deleted-id', imageCount: 0 },
      ],
      expiredImages: [{ documentId: 'live-id', imageCount: 1 }],
    }));

    await expect(handleScheduledCleanup({
      headers: { get: (name) => name === 'authorization' ? 'Bearer cron-secret' : null },
    }, cleanup, 'cron-secret')).resolves.toEqual({
      status: 200,
      body: { kind: 'cleaned', documentsRemoved: 2, imagesRemoved: 3, expiredImagesRemoved: 1 },
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('schedules the cleanup path once a day', () => {
    const vercel = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path: string; schedule: string }>;
      rewrites?: Array<{ source: string; destination: string }>;
    };
    expect(vercel.crons).toEqual([{ path: '/api/cleanup', schedule: expect.stringMatching(/^0 \d+ \* \* \*$/) }]);
    expect(vercel.rewrites?.some((rule) => rule.source.includes('api'))).toBe(true);
  });
});
