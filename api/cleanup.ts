import { cleanupDueDocuments } from '../src/document-lifecycle';
import { handleScheduledCleanup } from '../src/scheduled-cleanup';
import { createInstantRemovalStore } from './instant-removal-store';

export default async function handler(request: Request) {
  const store = createInstantRemovalStore();
  const result = await handleScheduledCleanup(
    request,
    () => store ? cleanupDueDocuments(store, new Date()) : Promise.resolve({ kind: 'not-configured' }),
  );
  return Response.json(result.body, { status: result.status });
}
