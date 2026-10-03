import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Db, DbKind } from './client';

const DATA_DIR = process.env.ORBITGENE_PGLITE_DIR ?? '.orbitgene/pglite';

/**
 * PGlite is a WASM build of Postgres. Next.js compiles Server Components and
 * Route Handlers into separate module graphs, so a plain module-level singleton
 * opens the same data directory twice and the two WASM instances then abort each
 * other. Pinning the instance to `globalThis` keeps exactly one per process.
 */
const globalRef = globalThis as typeof globalThis & {
  __orbitgenePglite?: Promise<PGlite>;
};

async function instance(): Promise<PGlite> {
  if (!globalRef.__orbitgenePglite) {
    globalRef.__orbitgenePglite = (async () => {
      // PGlite's bundled NodeFS calls a non-recursive mkdir, so a nested data
      // directory has to exist before the first open or it fails with ENOENT.
      mkdirSync(DATA_DIR, { recursive: true });
      return PGlite.create(DATA_DIR);
    })().catch((error) => {
      globalRef.__orbitgenePglite = undefined;
      throw error;
    });
  }
  return globalRef.__orbitgenePglite;
}

export async function pglite(): Promise<Db> {
  const pg = await instance();
  return {
    kind: 'pglite-embedded' as DbKind,
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const result = await pg.query<T>(sql, params as unknown[]);
      return result.rows;
    },
    async close() {
      // The process-wide instance is intentionally left open for reuse.
    },
  };
}