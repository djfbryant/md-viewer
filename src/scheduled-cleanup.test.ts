import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import cleanupHandler from '../api/cleanup';
import { handleScheduledCleanup } from './scheduled-cleanup';

afterEach(() => { vi.unstubAllEnvs(); });

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
    }));

    await expect(handleScheduledCleanup({
      headers: { get: (name) => name === 'authorization' ? 'Bearer cron-secret' : null },
    }, cleanup, 'cron-secret')).resolves.toEqual({
      status: 200,
      body: { kind: 'cleaned', documentsRemoved: 2, imagesRemoved: 2 },
    });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('runs the cron through document cleanup, which reports a deployment with no admin credentials', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    vi.stubEnv('INSTANT_APP_ID', '');
    vi.stubEnv('VITE_INSTANT_APP_ID', '');
    vi.stubEnv('INSTANT_APP_ADMIN_TOKEN', '');

    const response = await cleanupHandler(new Request('https://markshare.test/api/cleanup', {
      headers: { authorization: 'Bearer cron-secret' },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ kind: 'not-configured' });
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
