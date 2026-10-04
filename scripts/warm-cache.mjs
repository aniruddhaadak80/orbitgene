#!/usr/bin/env node
/**
 * Warms the gene profile cache on a deployment.
 *
 *   node scripts/warm-cache.mjs https://orbitgene.vercel.app
 *
 * Resolving a gene costs fifteen to twenty seconds of upstream calls, and a
 * serverless platform starts cold, so the first visitor to ask for BRCA1 pays
 * that cost and risks a function timeout. Running this after a deploy moves the
 * cost to a moment when nobody is waiting, and every later request becomes a
 * single row read.
 *
 * Safe to run repeatedly and safe to run concurrently: the writes are upserts
 * and the upstream fetches are read-only.
 */
const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
const catalog = await fetch(`${BASE}/api/catalog`).then((r) => r.json());

console.log(`Warming ${BASE}`);
console.log(`  store: ${health.store}, migration: ${health.migration}`);
console.log(`  ${catalog.catalog.length} catalogue genes\n`);

let ok = 0;
let failed = 0;

for (const entry of catalog.catalog) {
  const started = Date.now();
  process.stdout.write(`  ${entry.symbol.padEnd(9)} ${entry.accession} `);
  try {
    const response = await fetch(`${BASE}/api/catalog?accession=${entry.accession}`);
    const body = await response.json();
    if (!response.ok || body.error) {
      failed += 1;
      console.log(`FAILED (${response.status}) ${body.error?.message ?? ''}`);
      continue;
    }
    const live = body.sources.filter((s) => s.status === 'live').length;
    ok += 1;
    console.log(
      `${String(Date.now() - started).padStart(6)}ms  ${body.gene.symbol} ${body.gene.refseqMrna} ` +
        `${body.gene.cdsLength}nt / ${body.gene.proteinLength}aa  ` +
        `${body.annotatedTotal} annotations  ${live}/${body.sources.length} sources live`,
    );
  } catch (error) {
    failed += 1;
    console.log(`FAILED ${error.message}`);
  }
}

// A second pass proves the cache is doing its job rather than every call
// happening to be fast.
console.log('\n  second pass (should be fast):');
let warmTotal = 0;
for (const entry of catalog.catalog) {
  const started = Date.now();
  const response = await fetch(`${BASE}/api/catalog?accession=${entry.accession}`);
  if (response.ok) await response.json();
  const ms = Date.now() - started;
  warmTotal += ms;
  console.log(`  ${entry.symbol.padEnd(9)} ${String(ms).padStart(5)}ms`);
}
console.log(`  warm pass total: ${warmTotal}ms across ${catalog.catalog.length} genes`);

console.log(`\n${ok} resolved, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);