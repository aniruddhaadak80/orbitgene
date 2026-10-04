import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const path = join(homedir(), '.wow-repo-history.json');
const history = JSON.parse(await readFile(path, 'utf8'));

const entry = {
  repository: 'aniruddhaadak80/orbitgene',
  concept:
    "Flight-readiness triage for DNA assay hardware: pull a real protein substitution from UniProt, take the coding sequence from the annotated CDS of its RefSeq GenBank record and accept it only when it translates to the UniProt protein exactly, score it against probe thermodynamics, detector optics and the live NOAA radiation environment, add the ClinVar classification for that exact substitution, then seal the decision into a replayable SHA-384 chain",
  persona:
    'A student or DIY synthetic-biology lab ordering oligos, or a CubeSat payload engineer choosing between a readout and a launch slot, who needs to know whether one expensive next step is worth taking before paying for it',
  coreEntity:
    'Plate record - one scored substitution in one 96-well well, carrying its verdict, decision, ClinVar context, weather snapshot and audit chain',
  decisiveAction:
    'Enter a real UniProt residue, scrub any base of its codon while the ledger re-runs, read the five gates, commit the record to the plate with a seal, share it by token, and replay the chain',
  routeTopology: [
    '/',
    '/variants',
    '/bench',
    '/flight',
    '/agent',
    '/export',
    '/settings',
    '/verify',
    '/assay/[id]',
    '/s/[token]',
  ],
  liveDataSource:
    'UniProt REST (JSON entry and flat file), NCBI E-utilities (RefSeq GenBank record and ClinVar esearch/esummary) and NOAA SWPC JSON, all key-free and host-allowlisted, each labelled live or sealed fallback per response. ClinVar is queried for the exact substitution via UniProt three-letter protein change, not per gene',
  persistenceModel:
    'Neon Postgres in production via DATABASE_URL, transaction pooler; embedded PGlite for zero-config local dev and CI; production refuses to open a store without DATABASE_URL unless ORBITGENE_STORE=pglite is explicit. Resolved gene profiles are cached in a gene_profiles table because a cold resolve is 15-20s of upstream calls, which a serverless cold start would otherwise spend on the first visitor request',
  engine:
    'orbitgene/1.0.0: six weighted factors summing to 1 - physicochemical 0.20, assay signal 0.18, structural 0.16, probe thermodynamics 0.16, radiation integrity 0.16, codon consequence 0.14; five hard gates (probe-binds, signal-resolves, flight-cleared, structural-clear, evidence-present); verdicts FLIGHT-GO, GROUND-ONLY, REDESIGN-PROBE, HOLD-FOR-EVIDENCE; every factor returns checkable evidence and identical inputs return byte-identical responses',
  agentWorkflow:
    'MCP JSON-RPC 2.0 with nine tools (list_presets, get_space_weather, score_mutation, list_assays, get_assay, create_assay, record_decision, retire_assay, verify_integrity) over the same service layer as the UI, with readOnlyHint annotations and idempotent mutations stamped actor "agent"',
  visualMetaphor:
    '96-well microtiter plate under a fluorescence reader: every scored substitution is a lit well, and the whole product is a bench instrument readout',
  palette:
    'Near-black panel ink with cyan live/signal, magenta mutation and failed gates, lime cleared, amber caution, violet engine, on a cool graphite ground',
  typographyLayout:
    'Oxanium for display and Spline Sans Mono for readouts and factor evidence; instrument panels, tabular figures, uppercase tracked labels',
  motionModel:
    'Debounced re-scoring that redraws the whole factor ledger as a codon base is scrubbed, reduced-motion aware; the local model streams weight-download progress',
  signatureInteraction:
    'The mutation scrub: changing any single base of the codon re-runs the engine, recomputes the HGVS change and redraws all six factors and five gates in place, so the effect of one base is visible without leaving the page',
  repoUrl: 'https://github.com/aniruddhaadak80/orbitgene',
  liveUrl: 'https://orbitgene.vercel.app',
  devPostUrl:
    'https://dev.to/aniruddhaadak/i-built-a-triage-tool-so-my-friend-stops-ordering-dead-probes-1f8a',
  completionDate: '2026-10-04',
  challenge:
    'DEV Hacktoberfest Weekend Challenge: Build for a Friend (hf26challenge), window 2026-10-02 to 2026-10-05T06:59:00Z, prompt "build something with open-source AI at its core"',
  signature: {
    problemDomain: 'Triage of genetic substitutions against assay hardware and a radiation environment',
    primaryPersona:
      'Lab or payload engineer who must know whether one expensive next step is worth taking',
    coreEntity: 'Plate record with verdict, decision, sealed audit chain and replayable tombstone',
    decisiveUserAction: 'Score, scrub the codon, read the gates, commit to the plate, share, replay',
    routeAndInformationTopology:
      'Landing with a live demo, variant workbench, plate map, flight budget, agent console, export desk, integrity replay, settings, record detail, public share view',
    liveDataSource:
      'UniProt, RefSeq GenBank, ClinVar and NOAA SWPC, key-free with per-response live/fallback labelling',
    deterministicDecisionModel:
      'orbitgene/1.0.0 six-factor weighted score summing to 1, plus five hard threshold gates that outrank the score',
    agentWorkflow:
      'Nine JSON-RPC 2.0 tools over one shared service layer, owner-scoped by the orbitgene_sid cookie',
    visualMetaphor: '96-well fluorescence microtiter plate as a bench instrument readout',
    paletteAndContrast:
      'Panel ink ground with cyan live, magenta mutation, lime cleared, amber caution, violet engine',
    typographyAndLayoutRhythm: 'Oxanium display with Spline Sans Mono readouts, instrument panels, tabular figures',
    signatureInteractionOrMotionBehavior:
      'Single-base codon scrub re-runs the engine and redraws the full factor ledger in place',
  },
  verification: {
    typecheck: 'pass (tsc --noEmit, zero errors)',
    lint: 'pass (eslint, zero errors and zero warnings)',
    unitTests: '177 passed across canonical, genetics, thermo, radiation, integrity, engine, ClinVar and reference-guard suites',
    build: 'pass locally and on Vercel (Next.js 16.3.8)',
    liveVerifier: '91 of 91 passed against https://orbitgene.vercel.app',
    persistence:
      'neon-postgres confirmed by /api/health on production: durable true, migration 0006_catalog_alternate_residues, gene profile cache warm for all eight catalogue genes',
    mcp: 'tools/list confirmed on production: 9 tools with JSON schemas and readOnlyHint; unknown tool -32601 and invalid arguments -32602 both rejected',
    browserTests:
      'scripts/test-browser.mjs passed against production: deep link scores on load, ClinVar line rendered, the open-weight model ran on WebGPU and ranked all five diagnoses, zero console errors',
    docs:
      'README written against the running deployment with six screenshots captured from production; no placeholder alias anywhere; repository homepage set to the verified alias',
    repository: 'https://github.com/aniruddhaadak80/orbitgene public with the verified homepage and twelve topics',
    devPost:
      'published on DEV with tag hf26challenge, four embedded screenshots, description set, AI disclosure some_ai',
    deployment:
      'Vercel production alias https://orbitgene.vercel.app; DATABASE_URL set as a sensitive production variable via stdin so the secret never reached a command line; scripts/warm-cache.mjs warms the profile cache after deploy',
    noveltyAudit:
      'passed the 12-axis lock before scaffolding: genetics plus space-radiation triage on a 96-well plate instrument, distinct from every prior build in this history file, which are crypto, PQC, LLM-eval and market-data tools',
    openAiAtItsCore:
      'Xenova/nli-deberta-v3-xsmall runs in the browser through @huggingface/transformers on WebGPU, reading the factor ledger and ranking five diagnoses. Verified on the live deployment: 4481ms inference, no API key, no per-run cost, no assay data leaving the device, premise text shown to the reader, and the gates remain authoritative over the ranking',
    notableBugsFoundAndFixed: [
      "update assays ... returning seal was rejected by Postgres as an ambiguous column reference because the event CTE also exposes seal, so every update, decision and retirement silently failed with a 409 while the UI showed an error detail nobody read; the returning list is now qualified against the updated table",
      'five of the eight seeded catalogue featured positions named a reference residue the retrieved CDS does not encode (STAT1 31 is R not V, YWHAB 60 is S not L, BCL2L1 96 is E not S, HSP90AB1 496 is N not F, TUBB 172 is S not E), two asked for substitutions a single base change cannot make, and Q07817 was labelled BCL2L11 when it is BCL2L1. The app rendered confident, fully evidenced verdicts about residues that were never there. The engine now refuses any reference that disagrees with the sequence, and scripts/probe-seed-truth.mjs reads every catalogue entry back off live UniProt and RefSeq',
      'the ClinVar lookup returned null both when ClinVar genuinely held nothing and when NCBI rate-limited the request, so the UI could state that ClinVar has nothing on a variant nobody managed to ask about. Upstream failure is now carried through and rendered as a separate unavailable state, with a test asserting the three outcomes stay distinct',
      "isResidue deliberately accepts '*' for nonsense assays, so the ClinVar query builder produced 'TP53[gene] AND Ter1Ala', which matches nothing and reads as a real not-reported answer; stop codons are now excluded explicitly from a missense lookup",
      'production could not retrieve BRCA1 while local could: a cold gene resolve is 15-20s of upstream calls, the serverless function budget was shorter, and the kill surfaced as "upstream unavailable", blaming UniProt for our own timeout. Fixed with a Postgres profile cache (103s for eight genes cold, 1.4s warm), maxDuration, and a warm-cache script',
      'a deep link such as /variants?accession=P38398 scored nothing, because the effect that seeded the featured position depended on catalogue state that had not arrived; the seeded values are now derived during render',
      'the landing demo greeted every visitor with "choose a gene first" while displaying a gene already selected, because its score helper closed over the not-yet-loaded catalogue array',
      'the BRCA1 catalogue blurb claimed "170 annotated natural variants and 27 experimentally-characterised mutagenesis sites"; UniProt holds 76 and 4, so the numbers were invented. Replaced with a structural description and a correction migration, since the catalogue is only seeded when empty',
      'the catalogue response capped annotations at 80 while the source note counted all 193, so one entry read as two different facts; totals are now returned and the UI says "showing 80 of 193"',
      'LATEST_MIGRATION took the last array element and so reported 0003 while 0004 had been applied; it now compares ids numerically',
      'two corrections were written into a migration that had already run, and a migration is recorded by id, so editing its SQL changed nothing on any existing database; they were reissued as 0006 and CONTRIBUTING now states the rule',
      "NOAA reports Kp as estimated_kp, kp_index and labels such as '0P', and parseFloat('0P') is 0, so a quiet Sun read as a storm; the reader now takes the numeric fields first",
      'GenBank wrapped qualifiers were being swallowed into the CDS coordinates and minus-strand records were read forwards; both are handled, which is what lets the translation check pass on a gene like BRCA1',
      'thermodynamic lookup missed double strands and then silently deleted ambiguity codes to force a match, so all sixteen doublets are handled and any non-ACGT base is rejected instead of removed',
    ],
  },
  knownGaps: [
    'No rate limiting on /api/score or /api/assays, so they are unauthenticated and unmetered and can be used to burn upstream UniProt and NCBI quota. Documented in SECURITY.md rather than silently left unmentioned.',
    'The radiation constants are order-of-magnitude engineering estimates suitable for triage and teaching. There is no ADEC or TID qualification, and the flight page says so.',
    'ORBITGENE is not a diagnostic device and produces no clinical advice; the landing page and the DEV post both state this.',
    'Sealed fallbacks cover only P01308 and P99999, so an upstream outage leaves most of the catalogue unscoreable rather than degraded.',
    'Only eight genes are in the default catalogue, and the local model weighs in only on the diagnosis question rather than on any numeric output.',
  ],
};

if (history.builds.some((b) => b.repository === entry.repository)) {
  console.log('orbitgene already recorded, replacing it');
  history.builds = history.builds.filter((b) => b.repository !== entry.repository);
}

history.builds.push(entry);

await writeFile(path, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`history version ${history.version}, builds now ${history.builds.length}`);
console.log('latest:', history.builds[history.builds.length - 1].repository);
