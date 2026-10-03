/**
 * Proves the embedded adapter can actually open, migrate and write.
 * Used by the local setup check and by CI's zero-config job.
 */
import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const dir = process.env.ORBITGENE_PGLITE_DIR ?? '.orbitgene/pglite';

try {
  // PGlite's bundled NodeFS uses a non-recursive mkdir, so the directory has to
  // be created first. `src/lib/db/pglite.ts` does the same thing.
  mkdirSync(dir, { recursive: true });
  const pg = await PGlite.create(dir);
  const version = await pg.query('select version() as v');
  await pg.query('create table if not exists probe (id int)');
  await pg.query('insert into probe (id) values (1) on conflict do nothing');
  const count = await pg.query('select count(*)::int as n from probe');
  console.log(
    `pglite OK at ${dir} - ${String(version.rows[0].v).split(' ').slice(0, 2).join(' ')}, probe rows ${count.rows[0].n}`,
  );
} catch (error) {
  console.error('pglite FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
