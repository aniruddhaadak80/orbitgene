import type { Db } from './client';

/**
 * Schema and first-run seed.
 *
 * Migrations are plain idempotent SQL and are recorded in `schema_migrations`, so
 * a cold start on an empty Neon branch converges to the same shape as a local
 * database that has run the suite a hundred times.
 */

export const MIGRATIONS: Array<{ id: string; statements: string[] }> = [
  {
    id: '0001_core',
    statements: [
      `create table if not exists schema_migrations (
         id text primary key,
         applied_at timestamptz not null default now()
       )`,
      `create table if not exists assays (
         id uuid primary key,
         owner_id text not null,
         well text not null,
         gene_symbol text not null,
         uniprot_accession text not null,
         refseq_mrna text not null,
         protein_position integer not null,
         ref_aa text not null,
         alt_aa text not null,
         hgvs_p text not null,
         hgvs_c text not null,
         consequence text not null,
         probe_sequence text not null,
         instrument_id text not null,
         flight_profile_id text not null,
         notes text not null default '',
         status text not null default 'scored',
         score double precision not null,
         verdict text not null,
         decision jsonb,
         result jsonb not null,
         idempotency_key text,
         created_at timestamptz not null,
         updated_at timestamptz not null,
         deleted_at timestamptz,
         seal text not null,
         constraint assays_well_format check (well ~ '^[A-H]([1-9]|1[0-2])$'),
         constraint assays_score_range check (score >= 0 and score <= 100)
       )`,
      `create unique index if not exists assays_owner_idem_idx
         on assays (owner_id, idempotency_key)
         where idempotency_key is not null`,
      `create index if not exists assays_owner_created_idx
         on assays (owner_id, created_at desc)`,
      `create index if not exists assays_owner_live_idx
         on assays (owner_id, deleted_at)`,
      `create index if not exists assays_owner_gene_idx
         on assays (owner_id, lower(gene_symbol))`,
      `create table if not exists audit_events (
         id bigserial primary key,
         entity_id uuid not null,
         seq integer not null,
         action text not null,
         at timestamptz not null,
         actor text not null,
         detail jsonb not null,
         prev_seal text not null,
         seal text not null,
         unique (entity_id, seq)
       )`,
      `create index if not exists audit_entity_idx on audit_events (entity_id, seq)`,
      `create table if not exists share_links (
         token text primary key,
         assay_id uuid not null,
         owner_id text not null,
         created_at timestamptz not null
       )`,
      `create index if not exists share_assay_idx on share_links (assay_id)`,
      `create table if not exists sessions (
         id text primary key,
         created_at timestamptz not null,
         settings jsonb not null
       )`,
    ],
  },
  {
    id: '0002_gene_catalog',
    statements: [
      `create table if not exists gene_catalog (
         accession text primary key,
         symbol text not null,
         name text not null,
         blurb text not null,
         featured_position integer not null,
         featured_ref_aa text not null,
         featured_alt_aa text not null,
         sort_order integer not null default 0
       )`,
    ],
  },
];

/**
 * Reference catalog of reviewed human entries. Seeded with `ON CONFLICT DO
 * NOTHING`, so re-running never duplicates a row and never touches user data.
 * Positions are real UniProt mutagenesis or natural-variant sites.
 */
export const CATALOG_SEED: Array<{
  accession: string;
  symbol: string;
  name: string;
  blurb: string;
  featuredPosition: number;
  featuredRefAa: string;
  featuredAltAa: string;
  sortOrder: number;
}> = [
  {
    accession: 'P38398',
    symbol: 'BRCA1',
    name: 'Breast cancer type 1 susceptibility protein',
    blurb:
      'The double-strand break repair scaffold. 170 annotated natural variants and 27 experimentally-characterised mutagenesis sites make it the densest single gene for testing a triage model.',
    featuredPosition: 26,
    featuredRefAa: 'I',
    featuredAltAa: 'F',
    sortOrder: 1,
  },
  {
    accession: 'P04637',
    symbol: 'TP53',
    name: 'Cellular tumor antigen p53',
    blurb:
      'The most mutated protein in cancer. Its DNA-binding domain is a zinc-coordinated structure, so a substitution inside it scores very differently from one in the tail.',
    featuredPosition: 248,
    featuredRefAa: 'R',
    featuredAltAa: 'W',
    sortOrder: 2,
  },
  {
    accession: 'P00533',
    symbol: 'EGFR',
    name: 'Epidermal growth factor receptor',
    blurb:
      'A receptor tyrosine kinase with a long cytoplasmic tail. Useful for checking that the model does not simply rate every kinase residue as critical.',
    featuredPosition: 858,
    featuredRefAa: 'L',
    featuredAltAa: 'R',
    sortOrder: 3,
  },
  {
    accession: 'P42224',
    symbol: 'STAT1',
    name: 'Signal transducer and activator of transcription 1',
    blurb:
      'A coiled-coil dimerisation partner followed by a structured DNA-binding domain, which gives the structural-context factor two very different answers depending on position.',
    featuredPosition: 31,
    featuredRefAa: 'V',
    featuredAltAa: 'I',
    sortOrder: 4,
  },
  {
    accession: 'P31946',
    symbol: 'YWHAB',
    name: '14-3-3 protein beta/alpha',
    blurb:
      'A small helix-rich dimerisation partner. Almost every residue sits in an annotated helix, which is the honest worst case for a probe design.',
    featuredPosition: 60,
    featuredRefAa: 'L',
    featuredAltAa: 'P',
    sortOrder: 5,
  },
  {
    accession: 'Q07817',
    symbol: 'BCL2L11',
    name: 'Bcl-2-like protein 11',
    blurb:
      'A BH3-only apoptosis effector with an unstructured N-terminal tail, so early positions have no annotated structure to lean on.',
    featuredPosition: 96,
    featuredRefAa: 'S',
    featuredAltAa: 'R',
    sortOrder: 6,
  },
  {
    accession: 'P08238',
    symbol: 'HSP90AB1',
    name: 'Heat shock protein HSP 90-alpha',
    blurb:
      'A constitutive chaperone with long annotated helices. Included so the plate has at least one entry that should stay on the ground.',
    featuredPosition: 496,
    featuredRefAa: 'F',
    featuredAltAa: 'S',
    sortOrder: 7,
  },
  {
    accession: 'P07437',
    symbol: 'TUBB',
    name: 'Tubulin beta chain',
    blurb:
      'A beta-tubulin. Dominated by a continuous annotated helix, which makes it a clean control for the structural-context factor.',
    featuredPosition: 172,
    featuredRefAa: 'E',
    featuredAltAa: 'K',
    sortOrder: 8,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];

  // The bookkeeping table has to exist before it can be consulted, and it is
  // itself created by the first migration, so it is ensured up front rather than
  // being read on a database that has never been migrated.
  await db.query(
    `create table if not exists schema_migrations (
       id text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  for (const migration of MIGRATIONS) {
    const existing = await db.query<{ id: string }>(
      `select id from schema_migrations where id = $1`,
      [migration.id],
    );
    if (existing.length > 0) {
      applied.push(migration.id);
      continue;
    }

    for (const statement of migration.statements) {
      await db.query(statement);
    }
    await db.query(
      `insert into schema_migrations (id) values ($1) on conflict (id) do nothing`,
      [migration.id],
    );
    applied.push(migration.id);
  }

  return applied;
}

export async function seedCatalog(db: Db): Promise<number> {
  let inserted = 0;
  for (const entry of CATALOG_SEED) {
    const rows = await db.query<{ accession: string }>(
      `insert into gene_catalog
         (accession, symbol, name, blurb, featured_position, featured_ref_aa, featured_alt_aa, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (accession) do nothing
       returning accession`,
      [
        entry.accession,
        entry.symbol,
        entry.name,
        entry.blurb,
        entry.featuredPosition,
        entry.featuredRefAa,
        entry.featuredAltAa,
        entry.sortOrder,
      ],
    );
    inserted += rows.length;
  }
  return inserted;
}

/** Idempotent bootstrap used by every adapter on first connect. */
export async function ensureSchema(db: Db): Promise<void> {
  await migrate(db);
  await seedCatalog(db);
}

export const LATEST_MIGRATION = MIGRATIONS[MIGRATIONS.length - 1].id;