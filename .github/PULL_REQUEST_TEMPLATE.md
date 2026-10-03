# What to expect

- **Acknowledged** within a few days.
- **A verdict** either way. "Not planned" is a fine answer, with the reason.
- Small correctness fixes (wrong thermodynamics, broken SQL, bad HGVS, a source
  that lies about being live) get prioritised over anything cosmetic.

## How to get a change merged

1. **Open an issue first** for anything that touches the engine, the schema, the
   audit chain, or a source adapter. The reasoning matters more than the diff.
2. **One concern per pull request.** A fix plus a refactor plus a rename in one
   diff is three reviews wearing a trench coat.
3. **The test must be red before the fix is green.** Add the failing test, show
   that it fails, then fix it. This is how we prove the test is real.
4. **All four checks pass**: `npm run typecheck`, `npm run lint`, `npm test`,
   `npm run build`. CI runs them too.
5. **Engine changes bump the version.** `orbitgene/1.0.0` lives in
   `src/lib/engine.ts`. A score without its engine version is not evidence, so a
   change to any weight, threshold, factor, or gate must bump it.
6. **Do not weaken an honest fallback.** If upstream retrieval fails, the answer
   is a visible `fallback` status, never a synthesised value.
7. **Update the docs you invalidate**, especially `CONTRIBUTING.md` if you
   changed what the project asks of contributors.

## Reviewing

Reviews look for correctness and honesty first:

- Does the evidence array justify the score?
- Is the source status accurate?
- Does the audit chain still replay after this change?
- Is there a test that would have failed before the fix?

Style nits are welcome but never the reason a review is requested.