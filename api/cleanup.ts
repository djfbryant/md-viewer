import { createDocumentCleanup } from '../src/document-lifecycle';
import { handleScheduledCleanup } from '../src/scheduled-cleanup';
import { createInstantRemovalStore } from './instant-removal-store';

export default async function handler(request: Request) {
  const cleanup = createDocumentCleanup(createInstantRemovalStore());
  const result = await handleScheduledCleanup(request, cleanup);
  return Response.json(result.body, { status: result.status });
}
