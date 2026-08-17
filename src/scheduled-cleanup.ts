import type { CleanupDocumentOutcome } from './document-lifecycle';

export type ScheduledCleanupRequest = {
  headers: {
    get(name: string): string | null;
  };
};

export type ScheduledCleanupResult = {
  status: number;
  body: Record<string, unknown>;
};

export function cronRequestAuthorized(request: ScheduledCleanupRequest, secret = process.env.CRON_SECRET) {
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function handleScheduledCleanup(
  request: ScheduledCleanupRequest,
  cleanup: () => Promise<CleanupDocumentOutcome>,
  secret = process.env.CRON_SECRET,
): Promise<ScheduledCleanupResult> {
  if (!cronRequestAuthorized(request, secret)) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  const outcome = await cleanup();
  if (outcome.kind === 'cleaned') {
    const documentImageCount = outcome.removed.reduce((total, item) => total + item.imageCount, 0);
    const expiredImageCount = outcome.expiredImages.reduce((total, item) => total + item.imageCount, 0);
    return {
      status: 200,
      body: {
        kind: 'cleaned',
        documentsRemoved: outcome.removed.length,
        imagesRemoved: documentImageCount + expiredImageCount,
        expiredImagesRemoved: expiredImageCount,
      },
    };
  }
  return { status: outcome.kind === 'not-configured' ? 503 : 500, body: outcome };
}
