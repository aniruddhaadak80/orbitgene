/**
 * Database adapter contract.
 *
 * ORBITER talks to exactly one interface. Production resolves to Neon Postgres
 * (a real hosted store that survives redeploys and cold starts); local
 * development and the test suite resolve to an embedded PGlite instance, which
 * gives zero required environment variables.
 *
 * Production deliberately refuses to fall back to the embedded adapter: if
 * `DATABASE_URL` is absent in a production build the process throws instead of
 * silently accepting writes that would be lost.
 */

export type DbKind = 'neon-postgres' | 'pglite-embedded';

export interface Db {
  kind: DbKind;
  /** Parameterised query. Never interpolate user input into `sql`. */
  query<T = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
}

/**
 * True when the embedded adapter would be selected.
 *
 * `ORBITGENE_STORE=pglite` is an explicit opt-in and is honoured even in a
 * production build, because it is the documented way to run the whole app against
 * an embedded database (CI, a laptop, `next build && next start`). Without that
 * opt-in, a production build never falls back to the embedded adapter: if
 * `DATABASE_URL` is missing the process throws rather than accepting writes that
 * would vanish on the next cold start.
 *
 * `/api/health` reports `durable: false` whenever the embedded adapter answers,
 * so an explicit opt-in can never be mistaken for a hosted store.
 */
export function usingEmbeddedStore(): boolean {
  const explicit = process.env.ORBITGENE_STORE;
  if (explicit === 'pglite') return true;
  if (explicit === 'neon') return false;
  if (isProduction()) return false;
  return !process.env.DATABASE_URL;
}