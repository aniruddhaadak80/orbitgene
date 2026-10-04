# Contributing to ORBITGENE

Thanks for being here. This project is deliberately small in surface area and
careful about correctness, so the bar is mostly "show the reasoning".

## Getting it running

```bash
npm install
cp .env.example .env.local     # optional: leave DATABASE_URL unset for local work
npm run dev
```

With no `DATABASE_URL`, the app runs an embedded Postgres (PGlite) inside the
Node process and stores it in `.orbitgene/pglite`. Nothing to install, no
accounts, no keys.

The upstream biology is fetched live from UniProt, NCBI, and NOAA. Those are
public and keyless. If they are slow or unreachable, the app says so per source
and, for a small sealed set of accessions, falls back to a bundled copy that is
labelled `fallback` rather than pretending to be live.

## The checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # 158 unit tests, no network
npm run build       # production build
```

CI runs all four. Please make them pass.

There is also a live end-to-end verifier that drives the real HTTP surface,
including MCP, idempotency, seal conflicts, replay, and cross-session
isolation:

```bash
npm run verify:live                          # against localhost:3000
npm run verify:live -- https://your.vercel.app
```

`npm run probe:sources` prints whether each catalogue gene currently resolves
from UniProt and RefSeq. It is the quickest way to tell an upstream outage from
a bug in this repository.

## What makes a change easy to accept

**The engine is a contract.** `src/lib/engine.ts` is versioned
(`orbitgene/1.0.0`). If you change a weight, a threshold, a factor, or a gate,
bump the version in `src/lib/engine.ts` and in the schema migration seed
expectations. A score is only meaningful next to the version that produced it,
and existing sealed records reference it.

**Show the evidence.** Every factor and gate returns human-readable `evidence`
strings that a reader can check against the cited source. A factor with an empty
evidence array is a bug, and the verifier fails on it.

**Do not launder a fallback into a live answer.** `sources[].status` must be
`live` or `fallback`, honestly. Never synthesise an annotation, an amino acid,
or a codon that was not retrieved. If retrieval fails, the request should fail
or fall back visibly.

**Never mutate a sealed record.** Records are append-only through the audit
chain. Update and retire both append a new event and recompute the SHA-384
chain. Retirement leaves a tombstone so replay still works afterwards.

**Migrations are immutable.** They are recorded by id, so editing the SQL of a
migration that has already run changes nothing on any existing database — the
statement is simply skipped, silently. If you need a different statement, add a
new id. This repository learned that the hard way: two corrections were written
into a migration that had already shipped and had to be reissued as `0006`.

**The catalogue is checked against reality, not against itself.** The featured
residue in each seeded entry must match the retrieved coding sequence, and the
substitute must be reachable by a single base change. The engine now refuses a
reference residue that disagrees with the CDS, so drift surfaces as an error
rather than a confident score about a residue that is not there. To re-check the
catalogue against live UniProt and RefSeq:

```bash
node scripts/probe-seed-truth.mjs http://localhost:3000
```

**Tests fail before they pass.** If you fix a bug, add the test that was red.
The engine, thermodynamics, genetics, radiation, canonical serialisation, and
integrity chain all have unit tests in `tests/`.

## Good first issues

- Port the remaining engine factors to be independently testable.
- Add more sealed fallback accessions, with provenance recorded in
  `src/lib/sources/fallbacks.ts`.
- Widen the catalogue: any real human protein with a RefSeq CDS that translates
  to the UniProt sequence.
- Improve the flight-readiness copy on `/flight` with cited radiation sources.

## Style

TypeScript strict, no `any`. Prefer explicit types at module boundaries. Keep
functions small enough to test. Comments explain *why*, not *what*. Run
`npm run lint -- --fix` before pushing.