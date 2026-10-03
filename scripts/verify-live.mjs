#!/usr/bin/env node
/**
 * Live end-to-end verifier.
 *
 *   node scripts/verify-live.mjs                       # against http://localhost:3000
 *   node scripts/verify-live.mjs https://example.vercel.app
 *   BASE_URL=https://example.vercel.app node scripts/verify-live.mjs
 *
 * It reads the base URL from the argument or BASE_URL and never from a secret. No
 * key is needed because ORBITGENE has no accounts: a session is established by
 * loading the landing page and keeping the cookie, exactly as a browser does.
 *
 * Exits non-zero if any check fails, so CI can gate on it.
 */

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const REPO_URL = 'https://github.com/aniruddhaadak80/orbitgene';

let cookie = '';
let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
  return ok;
}

function headers(extra = {}) {
  return { ...(cookie ? { cookie } : {}), ...extra };
}

async function req(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: headers(options.headers ?? {}),
    redirect: 'manual',
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    const match = /orbitgene_sid=([0-9a-f]{32})/.exec(setCookie);
    if (match) cookie = `orbitgene_sid=${match[1]}`;
  }
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, text, json, headers: response.headers };
}

const rpc = (method, params, id = 1) =>
  req('/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
  });

async function main() {
  console.log(`\nVerifying ${BASE}\n${'='.repeat(60)}`);

  /* 1. Landing */
  const landing = await req('/');
  check('landing returns 200', landing.status === 200, `status ${landing.status}`);
  check('session cookie established', cookie !== '', cookie || 'none issued');

  /* 2. Health, with a real persistence round trip */
  const health = await req('/api/health');
  check('health returns 200', health.status === 200, `status ${health.status}`);
  const durable = health.json?.durable === true;
  const store = health.json?.store;
  const productionish = BASE.startsWith('https://') && !BASE.includes('localhost');
  check(
    'health reports the production store',
    productionish ? durable && store === 'neon-postgres' : true,
    `store=${store} durable=${durable}`,
  );
  check('health ran the migration', typeof health.json?.migration === 'string', `migration=${health.json?.migration}`);

  /* 3. Live data with source metadata */
  const catalog = await req('/api/catalog');
  check('catalog returns 200', catalog.status === 200);
  const entries = catalog.json?.catalog ?? [];
  check('catalog is populated', entries.length >= 8, `${entries.length} entries`);

  const gene = entries[0];
  const geneCtx = await req(`/api/catalog?accession=${gene.accession}`);
  check('gene context returns 200', geneCtx.status === 200, geneCtx.status === 200 ? '' : geneCtx.text.slice(0, 120));
  const sources = geneCtx.json?.sources ?? [];
  check('gene context carries source metadata', sources.length > 0, sources.map((s) => `${s.id}=${s.status}`).join(' '));
  check(
    'gene context is labelled live or fallback',
    sources.every((s) => s.status === 'live' || s.status === 'fallback'),
  );
  check('coding sequence retrieved', (geneCtx.json?.gene?.cdsLength ?? 0) > 0, `${geneCtx.json?.gene?.cdsLength} nt`);
  check('protein sequence retrieved', (geneCtx.json?.gene?.proteinLength ?? 0) > 0, `${geneCtx.json?.gene?.proteinLength} aa`);

  /* 4. Engine: create */
  const idem = `verify-${Date.now()}`;
  const createBody = {
    accession: gene.accession,
    proteinPosition: gene.featured.proteinPosition,
    refAa: gene.featured.refAa,
    altAa: gene.featured.altAa,
    well: 'B7',
    notes: 'created by the live verifier',
    idempotencyKey: idem,
  };
  const created = await req('/api/assays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  check('record created', created.status === 201 || created.status === 200, `status ${created.status}`);
  const assay = created.json?.assay;
  check('record has an id', Boolean(assay?.id), assay?.id ?? '');
  check('record has a 96-character seal', assay?.seal?.length === 96, assay?.seal?.slice(0, 16));

  /* 5. Read back */
  const listed = await req('/api/assays?limit=96');
  const found = (listed.json?.items ?? []).find((a) => a.id === assay?.id);
  check('record read back through the API', Boolean(found), `total ${listed.json?.total}`);
  check('read-back score matches create', found?.score === assay?.score, `${found?.score}`);

  /* 6. Update, then prove persistence */
  const patched = await req(`/api/assays/${assay.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'probe-ordered', notes: 'updated by the live verifier' }),
  });
  check('record updated', patched.status === 200, `status ${patched.status} ${patched.status === 200 ? '' : patched.text.slice(0, 160)}`);
  check(
    'update changed the seal',
    patched.status === 200 ? patched.json?.assay?.seal !== assay.seal : false,
    patched.status === 200 ? `${assay.seal.slice(0, 12)} -> ${patched.json?.assay?.seal?.slice(0, 12)}` : 'not evaluated',
  );
  const reread = await req(`/api/assays/${assay.id}`);
  check('update persisted', reread.json?.assay?.status === 'probe-ordered', reread.json?.assay?.status);
  check('update persisted notes', reread.json?.assay?.notes === 'updated by the live verifier');

  /* 7. Deterministic engine over its own endpoint */
  const scored = await req('/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accession: gene.accession,
      proteinPosition: gene.featured.proteinPosition,
      altAa: gene.featured.altAa,
    }),
  });
  const result = scored.json?.result;
  check('engine returns a versioned score', typeof result?.engine === 'string' && typeof result?.score === 'number', `${result?.engine} ${result?.score}`);
  check('engine itemises six factors', result?.factors?.length === 6, `${result?.factors?.length}`);
  check(
    'factors carry weights and evidence',
    result?.factors?.every((f) => typeof f.weight === 'number' && Array.isArray(f.evidence) && f.evidence.length > 0),
  );
  check('engine returns five gates', result?.gates?.length === 5, `${result?.gates?.length}`);
  check('engine returns a recommendation', typeof result?.verdict === 'string', result?.verdict);
  check('engine returns a verification reference', typeof result?.inputDigest === 'string' && result.inputDigest.length === 64);
  check('engine reports HGVS', /^c\./.test(result?.codon?.hgvsC ?? ''), result?.codon?.hgvsC);
  check('engine reports probe thermodynamics', typeof result?.thermo?.deltaTmC === 'number', `${result?.thermo?.deltaTmC} C ${result?.thermo?.class}`);

  const scoredTwice = await req('/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      accession: gene.accession,
      proteinPosition: gene.featured.proteinPosition,
      altAa: gene.featured.altAa,
    }),
  });
  check(
    'engine is deterministic for the same inputs',
    JSON.stringify(scoredTwice.json?.result) === JSON.stringify(result),
  );

  /* 7b. ClinVar clinical context */
  const clinical = scored.json?.clinical;
  check(
    'clinical context states one of three honest outcomes',
    ['reported', 'not-reported', 'unavailable'].includes(clinical?.status),
    clinical?.status,
  );
  check('clinical context carries a source entry', typeof clinical?.source?.id === 'string', clinical?.source?.id);
  check(
    'clinical source is labelled live or fallback',
    ['live', 'fallback'].includes(clinical?.source?.status),
    clinical?.source?.status,
  );

  if (clinical?.status === 'reported') {
    const hit = clinical.hit;
    check('clinical hit is a ClinVar variation accession', /^VCV\d+$/.test(hit?.accession ?? ''), hit?.accession);
    check('clinical hit carries a significance', typeof hit?.significance === 'string' && hit.significance.length > 0, hit?.significance);
    check('clinical hit carries a review status', typeof hit?.reviewStatus === 'string' && hit.reviewStatus.length > 0, hit?.reviewStatus);
    check('clinical hit links to ClinVar', /^https:\/\/www\.ncbi\.nlm\.nih\.gov\/clinvar\//.test(hit?.url ?? ''), hit?.url);
  }

  if (clinical?.status === 'not-reported') {
    check(
      'an unreported variant is not described as benign',
      !/benign/i.test(clinical?.source?.note ?? ''),
      clinical?.source?.note?.slice(0, 80),
    );
  }

  // A substitution ClinVar certainly has classified: TP53 R175H is Pathogenic
  // and reviewed by an expert panel. If this regresses to "not-reported" the
  // lookup has silently stopped working rather than the data changing.
  const tp53 = await req('/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accession: 'P04637', proteinPosition: 175, refAa: 'R', altAa: 'H' }),
  });
  check(
    'a known ClinVar substitution resolves (TP53 R175H)',
    tp53.json?.clinical?.status === 'reported' &&
      tp53.json?.clinical?.hit?.accession === 'VCV000012374' &&
      /pathogenic/i.test(tp53.json?.clinical?.hit?.significance ?? ''),
    `${tp53.json?.clinical?.status} ${tp53.json?.clinical?.hit?.significance ?? ''} ${tp53.json?.clinical?.hit?.accession ?? ''}`,
  );
  const scoreSources = scored.json?.sources ?? [];
  const scoreSourceIds = [...new Set(scoreSources.map((s) => s.id))];
  check(
    'a score names uniprot, refseq and clinvar',
    ['uniprot', 'refseq-cds', 'clinvar'].every((id) => scoreSourceIds.includes(id)),
    scoreSourceIds.join(' '),
  );
  check(
    'every source on a score is labelled live or fallback',
    scoreSources.every((s) => s.status === 'live' || s.status === 'fallback'),
    scoreSources.map((s) => `${s.id}=${s.status}`).join(' '),
  );

  /* 8. MCP */
  const init = await rpc('initialize');
  check('MCP initialize succeeds', Boolean(init.json?.result?.protocolVersion), `protocol ${init.json?.result?.protocolVersion}`);
  check('MCP reports server info', init.json?.result?.serverInfo?.name === 'orbitgene');

  const tools = await rpc('tools/list');
  const toolList = tools.json?.result?.tools ?? [];
  const names = toolList.map((t) => t.name);
  check('MCP tools/list returns tools', toolList.length >= 3, `${toolList.length} tools`);
  check('MCP publishes a read tool', names.includes('score_mutation') && names.includes('list_assays'), names.join(','));
  check('MCP publishes a mutating tool', names.includes('create_assay') && names.includes('record_decision'));
  check('MCP publishes integrity verification', names.includes('verify_integrity'));
  check(
    'MCP tools carry JSON schemas',
    toolList.every((t) => t.inputSchema && t.inputSchema.type === 'object'),
  );
  check('MCP annotates read-only tools', toolList.filter((t) => t.annotations?.readOnlyHint).length >= 2);

  const unknown = await rpc('tools/call', { name: 'definitely_not_a_tool' });
  check('MCP rejects an unknown tool', unknown.json?.error?.code === -32601, `code ${unknown.json?.error?.code}`);
  const badParams = await rpc('tools/call', { name: 'get_assay', arguments: { id: 'not-a-uuid' } });
  check('MCP rejects invalid arguments', badParams.json?.error?.code === -32602, `code ${badParams.json?.error?.code}`);

  /* 9. MCP mutation through the same path, with idempotency */
  const mcpIdem = `verify-mcp-${Date.now()}`;
  const mcpCreate = await rpc('tools/call', {
    name: 'create_assay',
    arguments: {
      accession: gene.accession,
      proteinPosition: gene.featured.proteinPosition,
      refAa: gene.featured.refAa,
      altAa: gene.featured.altAa,
      well: 'C3',
      idempotencyKey: mcpIdem,
    },
  });
  const agentAssay = mcpCreate.json?.result?.structuredContent?.assay;
  check('MCP mutating tool wrote a record', Boolean(agentAssay?.id), agentAssay?.id ?? JSON.stringify(mcpCreate.json).slice(0, 200));
  check('MCP records the actor as an agent', mcpCreate.json?.result?.structuredContent?.actor === 'agent');

  const mcpRetry = await rpc('tools/call', {
    name: 'create_assay',
    arguments: {
      accession: gene.accession,
      proteinPosition: gene.featured.proteinPosition,
      refAa: gene.featured.refAa,
      altAa: gene.featured.altAa,
      well: 'C3',
      idempotencyKey: mcpIdem,
    },
  });
  check(
    'MCP mutation is idempotent on a repeated key',
    mcpRetry.json?.result?.structuredContent?.replayed === true &&
      mcpRetry.json?.result?.structuredContent?.assay?.id === agentAssay?.id,
  );

  const afterAgent = await req('/api/assays?limit=96');
  const agentVisible = (afterAgent.json?.items ?? []).find((a) => a.id === agentAssay?.id);
  check('agent record is visible over REST', Boolean(agentVisible), agentVisible ? `well ${agentVisible.well}` : 'not visible');

  /* 10. Integrity replay before deletion */
  const replay = await req(`/api/integrity/${assay.id}`);
  check('integrity replay returns 200', replay.status === 200);
  check('integrity replay is clean', replay.json?.report?.ok === true, `${replay.json?.report?.length} events`);
  check('integrity reports a genesis', typeof replay.json?.report?.genesis === 'string', replay.json?.report?.genesis);
  check('integrity reports no broken link', replay.json?.report?.brokenAt === null);

  const mcpVerify = await rpc('tools/call', { name: 'verify_integrity', arguments: { id: assay.id } });
  check(
    'MCP verifies the same chain',
    mcpVerify.json?.result?.structuredContent?.report?.ok === true,
  );

  /* 11. Share link */
  const share = await req('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ assayId: assay.id }),
  });
  check('share token minted', Boolean(share.json?.token), share.json?.path ?? '');
  const shared = await fetch(`${BASE}/api/share/${share.json?.token}`);
  const sharedJson = await shared.json().catch(() => null);
  check('share link readable without a session', shared.status === 200 && sharedJson?.assay?.id === assay.id);
  check('share re-verifies integrity', sharedJson?.integrity?.ok === true, `${sharedJson?.integrity?.length} events`);

  /* 12. Destructive guards and tombstone */
  const noSeal = await req(`/api/assays/${assay.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  check('delete without a seal is refused', noSeal.status === 400, `status ${noSeal.status}`);

  const wrongSeal = await req(`/api/assays/${assay.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seal: '0'.repeat(96), confirm: true }),
  });
  check('delete with a wrong seal is refused', wrongSeal.status === 409, `status ${wrongSeal.status}`);

  // A stale seal must also be refused, which is the point of sealing the record:
  // the seal read at create time is no longer current after the update above.
  const staleSeal = await req(`/api/assays/${assay.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seal: assay.seal, confirm: true }),
  });
  check('delete with a stale seal is refused', staleSeal.status === 409, `status ${staleSeal.status}`);

  const currentSeal = reread.json?.assay?.seal;
  const deleted = await req(`/api/assays/${assay.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seal: currentSeal, confirm: true }),
  });
  check('delete with the current seal succeeds', deleted.status === 200, `status ${deleted.status} ${deleted.status === 200 ? '' : deleted.text.slice(0, 160)}`);
  check('delete leaves a tombstone', deleted.json?.tombstone === true);

  const goneRead = await req(`/api/assays/${assay.id}`);
  check('retired record is no longer readable', goneRead.status === 404, `status ${goneRead.status}`);

  const goneList = await req('/api/assays?limit=96');
  check(
    'retired record is absent from the plate',
    !(goneList.json?.items ?? []).some((a) => a.id === assay.id),
  );

  const tombReplay = await req(`/api/integrity/${assay.id}`);
  check('tombstone still replays clean', tombReplay.json?.report?.ok === true, `${tombReplay.json?.report?.length} events`);
  check('tombstone replay reports the deletion', Boolean(tombReplay.json?.tombstone?.deletedAt));

  /* 13. Cross-session isolation */
  if (agentAssay?.id) {
    const savedCookie = cookie;
    cookie = '';
    await req('/');
    check('a second session gets its own id', cookie !== '' && cookie !== savedCookie);
    const crossRead = await req(`/api/assays/${agentAssay.id}`);
    check("another session cannot read this session's record", crossRead.status === 404, `status ${crossRead.status}`);
    const crossList = await req('/api/assays?limit=96');
    check("another session's plate is empty", (crossList.json?.total ?? 0) === 0, `total ${crossList.json?.total}`);
    cookie = savedCookie;
  } else {
    check('cross-session isolation', false, 'skipped: no agent record to test with');
  }

  /* 14. Input validation */
  const badAccession = await req('/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accession: 'nope!', proteinPosition: 1, altAa: 'V' }),
  });
  check('a malformed accession is rejected', badAccession.status === 400, `status ${badAccession.status}`);

  const badWell = await req('/api/assays', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accession: gene.accession, proteinPosition: 1, refAa: 'A', altAa: 'V', well: 'Z99' }),
  });
  check('an impossible well is rejected', badWell.status === 400, `status ${badWell.status}`);

  const impossible = await req('/api/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accession: gene.accession, proteinPosition: 99999, altAa: 'V' }),
  });
  check('an impossible position is rejected', impossible.status === 422 || impossible.status === 400, `status ${impossible.status}`);

  /* 15. Every user route and the GitHub link */
  const routes = ['/', '/variants', '/bench', '/flight', '/agent', '/export', '/settings', '/verify'];
  for (const route of routes) {
    const page = await req(route);
    check(`route ${route}`, page.status === 200, `status ${page.status}`);
  }

  const homeHtml = landing.text;
  const occurrences = homeHtml.split(REPO_URL).length - 1;
  check('repository URL present in the rendered page', occurrences >= 2, `${occurrences} occurrences`);
  check('repository link has visible text', /View source|Star on GitHub/.test(homeHtml));
  check('repository links are marked noopener', /href="https:\/\/github\.com\/aniruddhaadak80\/orbitgene"[^>]*rel="noopener noreferrer"/.test(homeHtml));

  const repoResponse = await fetch(REPO_URL, { redirect: 'follow' });
  check('the repository URL resolves', repoResponse.status === 200, `status ${repoResponse.status}`);

  const mcpManifest = await req('/mcp.json');
  check('MCP manifest is published', mcpManifest.status === 200 && typeof mcpManifest.json?.name === 'string', mcpManifest.json?.name);
  check(
    'MCP manifest points at the live endpoint',
    String(mcpManifest.json?.remotes?.[0]?.url ?? '').startsWith(BASE),
    mcpManifest.json?.remotes?.[0]?.url,
  );

  /* 16. Clean up the agent-created record so a rerun starts fresh */
  const agentRecord = agentAssay?.id ? await req(`/api/assays/${agentAssay.id}`) : null;
  if (agentAssay?.id) {
    await req(`/api/assays/${agentAssay.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seal: agentRecord?.json?.assay?.seal ?? agentAssay.seal, confirm: true }),
    });
  }

  console.log(`${'='.repeat(60)}\n${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log(`\nFailing checks:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nverifier crashed:', error);
  process.exit(1);
});
