import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import type { Db, DbKind } from './client';

type Query = NeonQueryFunction<false, false>;

const globalRef = globalThis as typeof globalThis & {
  __orbitgeneNeon?: Query;
};

function client(): Query {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Production ORBITGENE requires a hosted Postgres; the embedded adapter is development-only.',
    );
  }
  if (!globalRef.__orbitgeneNeon) {
    globalRef.__orbitgeneNeon = neon(url, { fullResults: false }) as unknown as Query;
  }
  return globalRef.__orbitgeneNeon;
}

export async function neonDb(): Promise<Db> {
  return {
    kind: 'neon-postgres' as DbKind,
    async query<T = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      const rows = await client().query(sql, params as unknown[]);
      return (rows ?? []) as T[];
    },
    async close() {
      // Neon's HTTP driver holds no long-lived socket.
    },
  };
}