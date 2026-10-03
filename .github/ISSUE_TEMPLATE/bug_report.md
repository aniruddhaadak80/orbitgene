<!--
Thanks for taking the time. A good report here is mostly about pinning down
which layer the problem is in: the UI, the API, the engine, or an upstream
source.
-->

### What happened

<!-- A clear description of the wrong behaviour. -->

### What you expected

### Steps to reproduce

<!--
For a scoring or data problem, these four fields are what matter:

  accession          e.g. P38398
  protein position   1-based residue number
  reference / alt aa e.g. I > F
  well               e.g. B7

Also include, if you have it:
  - the engine version from the UI or the API response
  - the `sources` array from GET /api/catalog?accession=...
  - whether you were on the deployment or running locally
-->

1.
2.
3.

### Environment

- ORBITGENE commit:
- Node version:
- Deployed or local:
- Browser (if this is a UI problem):

### Upstream status

<!--
If the score looked wrong rather than the page breaking, paste the `sources`
status from the response. `live` means the data came from UniProt and RefSeq.
`fallback` means the app served a sealed bundled copy instead, and curated
annotations are intentionally empty in that case.
-->