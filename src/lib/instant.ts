import { id, init } from '@instantdb/react';
import schema from '../../instant.schema';

/**
 * Client database for future document flows. VITE_INSTANT_APP_ID is deliberately
 * required at deployment time; the bootstrap shell itself makes no database calls.
 */
const appId = import.meta.env.VITE_INSTANT_APP_ID;

export const db = appId ? init({ appId, schema }) : null;

export const createDocumentId = id;
