import { isProduction, usingEmbeddedStore, type Db } from './client';
import { neonDb } from './neon';
import { pglite } from './pglite';
import { ensureSchema } from './schema';

const globalRef = globalThis as typeof globalThis & {
  __orbitgeneDb?: Promise<Db>;
};

/**
 * Resolves the adapter once per process, runs the idempotent migration and
 * returns it.
 *
 * A production build with no `DATABASE_URL` throws. That is deliberate: silently
 * starting an embedded database on a serverless filesystem would accept writes
 * that vanish on the next cold start, and `/api/health` would report a durable
 * store that is not one.
 */
export async function getDb(): Promise<Db> {
  const explicitlyEmbedded = process.env.ORBITGENE_STORE === 'pglite';

  if (isProduction() && !process.env.DATABASE_URL && !explicitlyEmbedded) {
    throw new Error(
      'ORBITGENE production requires DATABASE_URL pointing at a hosted Postgres. Refusing to boot without a durable store.',
    );
  }

  if (!globalRef.__orbitgeneDb) {
    globalRef.__orbitgeneDb = (async () => {
      const db = usingEmbeddedStore() ? await pglite() : await neonDb();
      await ensureSchema(db);
      return db;
    })().catch((error) => {
      // Do not cache a failed connection: a later request should retry.
      globalRef.__orbitgeneDb = undefined;
      throw error;
    });
  }

  return globalRef.__orbitgeneDb;
}

export { usingEmbeddedStore, isProduction } from './client';
export type { Db } from './client';
export { LATEST_MIGRATION } from './schema';