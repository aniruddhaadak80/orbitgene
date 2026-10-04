**Live:** https://orbitgene.vercel.app
**Code:** https://github.com/aniruddhaadak80/orbitgene

I built ORBITGENE because of a friend who runs a small molecular biology lab.

She was spending money on oligos. Not recklessly, and not carelessly — she just had no way to answer one question before ordering: *if this mutation is real, is it even worth an assay?* So she'd order probes for everything the database flagged, run them, and find out that most of them told her nothing. That's not a knowledge problem. The knowledge is public and excellent. It's a **triage** problem, and nobody had built her a triage tool.

Then a second thing happened that I did not expect. I gave the tool a friendlier job — *would this readout survive a launch slot?* — and realised the two questions are the same question. Both are: **given what we now know, is this worth the next expensive step?**

## What it does

You give it a real protein substitution. It retrieves the actual biology and answers with evidence you can check.

![ORBITGENE: a 96-well plate beside a live readiness read](https://raw.githubusercontent.com/aniruddhaadak80/orbitgene/main/docs/screenshots/01-landing.png)

Four public, keyless sources, each labelled `live` or `fallback` on every single response:

- **UniProt** — the protein, its structural features, its curated variant annotations
- **RefSeq** — the coding sequence, sliced out of the annotated `CDS` in the GenBank record
- **ClinVar** — the classification for *that exact substitution*
- **NOAA SWPC** — planetary K index, GOES X-ray class, proton flux, feeding a radiation budget

No account. No API key. You land on a working page.

## The bug I found by not trusting the data

The mRNA is not the coding sequence, and the gene is not the coding sequence either. Most naive implementations read the mRNA, translate it, and confidently score a slightly wrong sequence.

So I don't. ORBITGENE fetches the GenBank record, reads the annotated `CDS` location, extracts exactly those bases, and then accepts the sequence **only when it translates to the UniProt protein residue for residue**.

That single check catches a whole family of silent bugs at once: a minus-strand gene read forwards, a truncated isoform, a transcript from a different gene, a wrapped GenBank qualifier that swallowed a coordinate.

UniProt rarely offers one transcript, so candidates come from two independent routes — the RefSeq cross-references in the flat file, and NCBI's protein-to-mRNA link — and each is tried until one translates cleanly. BRCA1 resolves to `NM_001407593.1`: 5592 nt for 1863 residues, exact match.

![The workbench with a scored BRCA1 substitution, ClinVar, and the factor ledger](https://raw.githubusercontent.com/aniruddhaadak80/orbitgene/main/docs/screenshots/02-workbench-scored.png)

The third genuine bug: five of my eight seeded catalogue positions named a **reference residue the retrieved sequence does not encode**. STAT1 31 is R, not V. YWHAB 60 is S, not L. One asked for Glu→Arg, which no single base change can make. One was labelled `BCL2L11` when the accession `Q07817` is `BCL2L1` — a different protein entirely.

None of that was visible. The app rendered a confident, fully evidenced verdict about a residue that was never there.

The fix is the part I care about: **the engine now refuses a reference residue that disagrees with the coding sequence.** It cannot score a residue that does not exist. I also added `scripts/probe-seed-truth.mjs`, which reads every catalogue entry back off live UniProt and RefSeq and tells you which ones disagree.

I mention this because the failure mode was silence. Nothing errored. The page looked great.

## ClinVar for the substitution, not the gene

`BRCA1[gene]` matches **16,094** variants. That tells you nothing about the one in your well.

ClinVar indexes UniProt-style three-letter protein changes, so ORBITGENE asks `TP53[gene] AND Arg175His` and gets exactly one record:

| Substitution | ClinVar | Classification | Review status |
|---|---|---|---|
| TP53 R175H | `VCV000012374` | **Pathogenic** | reviewed by expert panel |
| EGFR L858R | `VCV000016609` | **drug response** | reviewed by expert panel |
| BRCA1 I26F | `VCV000827206` | Uncertain significance | multiple submitters, no conflicts |

Three outcomes, deliberately kept apart: `reported`, `not-reported`, and `unavailable`.

That third one exists because I shipped the bug first. My lookup returned `null` both when ClinVar genuinely held nothing *and* when NCBI rate-limited me. Which means the app would tell a reader that ClinVar has nothing on a variant **nobody managed to ask about**. A timeout dressed up as scientific evidence. Now the failure is carried through and rendered as a failure.

## The engine

`orbitgene/1.0.0`. Six weighted factors, five hard gates, one verdict, and no black box anywhere.

| Factor | Weight |
|---|---|
| Physicochemical displacement | 0.20 |
| Assay signal budget | 0.18 |
| Structural context | 0.16 |
| Probe thermodynamics | 0.16 |
| Radiation integrity | 0.16 |
| Codon consequence | 0.14 |

Weights sum to 1, so the score is a plain weighted mean and nothing gets redistributed when a factor is unreadable. Gates are thresholds and they are the authority: `FLIGHT-GO`, `GROUND-ONLY`, `REDESIGN-PROBE`, `HOLD-FOR-EVIDENCE`.

Every factor returns the numbers behind it. The BRCA1 example fails `probe-binds` for one concrete reason: a 21-mer with one mismatched base shifts the duplex melting temperature by **0.06 °C**, and nothing separates a 0.06 °C difference. ΔG in kcal/mol, SNR over a 40 ms window, dose in krad, the exact base that changed.

The score carries the version of the engine that produced it, because a score without its version is not evidence.

## Why open mattered here

This is the part the challenge actually asks about, so I want to be concrete rather than sentimental.

The engine is deterministic on purpose. Deterministic code is reviewable, testable, and diffable — you can argue with a threshold. But it is *terrible* at explaining itself in prose. A factor ledger says `support: 0.00`. That is precise and completely unhelpful to a human staring at it.

So I handed the ledger to an open-weight NLI model, `Xenova/nli-deberta-v3-xsmall`, running in the browser through `@huggingface/transformers` on WebGPU:

![The local model's ranked diagnoses, showing it ran on WebGPU in the browser](https://raw.githubusercontent.com/aniruddhaadak80/orbitgene/main/docs/screenshots/03-local-model-explanation.png)

It answers one question: which of five diagnoses does this evidence best support? On BRCA1 I26F it returns *"a probe that no longer discriminates this variant and must be redesigned"* at **40.4%** — which agrees with the failed gate. But that agreement is a *result*, not something the UI assumes.

What I gained by keeping this open and local:

- **It runs on your machine.** WebGPU, ~4.5 s inference, verified working on the live site. No API key, no cost per run, no quota.
- **No assay data leaves the device.** Not the sequence, not the notes, not the records. For a lab, "where does my unpublished construct go" is the first question, not the last.
- **The model is swappable.** It is one string in one component. Swap in a larger NLI model, a local Llama, or quantise it differently — it is a file in the dependency tree, not a vendor relationship.
- **The model is inspectable.** The panel shows the exact premise text sent to the model, so you can read its input and judge it. When the ranking and the gates disagree, you can see precisely why.
- **It degrades honestly.** It loads only when asked. If it fails, the score and the gates are untouched and the panel says so.

Where this beat a closed API, specifically: a hosted classifier would have needed the user's sequence sent to a third party and a paid key per user. For an unauthenticated research tool that anyone can use, that was disqualifying. Open wasn't a philosophical preference here; it was the only architecture that let the feature exist at all.

## Everything else is real too

**Radiation that is computed, not asserted.** GCR and SPE dose rates, a shielding curve, dose over a mission, expected single-event upsets, and the redundant readouts needed to push corruption probability under the bound. Every constant is printed on the page so you can substitute your own.

![Flight budget: three orbit profiles, an attenuation curve, and the constants behind the model](https://raw.githubusercontent.com/aniruddhaadak80/orbitgene/main/docs/screenshots/05-flight-budget.png)

That screenshot caught NOAA GOES returning 404 while the planetary K index still resolved, and the page reports exactly that instead of substituting a plausible number.

**An audit chain you can replay.** Every create, update, decision and retirement appends an event to a SHA-384 chain. Retiring requires echoing the current seal, and a **stale** seal is refused with `409` — so a tab left open all afternoon cannot silently overwrite what you are looking at. Retirement leaves a tombstone, so history stays replayable.

**An MCP server**, nine tools, `readOnlyHint` annotated, mutations stamped `actor: "agent"`:

```json
{ "mcpServers": { "orbitgene": { "type": "http", "url": "https://orbitgene.vercel.app/api/mcp" } } }
```

**No accounts.** An anonymous session cookie, per-session isolation, and a record belonging to another session reported exactly like one that does not exist.

## Verify it yourself

I did not want you to trust the screenshots.

```bash
git clone https://github.com/aniruddhaadak80/orbitgene
cd orbitgene
npm install
npm test          # 177 unit tests, no network
npm run dev       # embedded Postgres in-process, nothing to install
```

And the part I'm happiest with, which runs **91 end-to-end checks against a live server** — MCP handshake and error codes, idempotent mutations, stale and wrong seal conflicts, replay of a tombstoned chain, cross-session isolation, and a check that identical inputs produce byte-identical responses:

```bash
npm run verify:live -- https://orbitgene.vercel.app
```

That currently reports **91 passed, 0 failed** against the deployment linked above.

One more check worth running, because it's the one that caught my bad data:

```bash
node scripts/probe-seed-truth.mjs https://orbitgene.vercel.app
```

## What I'd tell my friend

Order fewer dead probes. That's the whole promise.

Concretely: a real substitution goes in, real UniProt and RefSeq sequences come back, ClinVar says what clinicians have actually concluded, the physics says whether your detector and your probe can tell the difference, the radiation budget says whether the readout survives, and you get a number with its evidence attached and a record you can hand to someone who will not take your word for it.

It is not a diagnostic. It is not clinical advice. A score says whether a substitution is worth an assay and a flight slot, not whether a person has a condition. The radiation constants are engineering estimates for triage and teaching, not hardware qualification.

MIT licensed. Data from UniProt, NCBI and NOAA under their own terms.

If you know someone ordering probes by a database flag, send them this. Then tell me what they said — that is genuinely the part I want to hear.

**#hf26challenge**
