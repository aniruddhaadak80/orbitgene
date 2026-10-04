const B = process.argv[2] ?? 'http://localhost:3210';

const catalog = await (await fetch(`${B}/api/catalog`)).json();
console.log(`Checking ${catalog.catalog.length} seeded featured positions against the retrieved CDS\n`);

let wrong = 0;
for (const entry of catalog.catalog) {
  const gene = await (await fetch(`${B}/api/catalog?accession=${entry.accession}`)).json();
  const position = entry.featured.proteinPosition;
  const seededRef = entry.featured.refAa;

  // Ask without a reference and let the engine read the residue off the CDS.
  const response = await fetch(`${B}/api/score`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accession: entry.accession, proteinPosition: position, altAa: entry.featured.altAa }),
  });
  const body = await response.json();

  if (!response.ok || body.error) {
    console.log(`${entry.symbol} pos ${position}: REQUEST FAILED ${body.error?.message ?? response.status}`);
    wrong += 1;
    continue;
  }

  const actual = body.result.codon.refAa;
  const ok = actual === seededRef;
  if (!ok) wrong += 1;
  console.log(
    `${ok ? 'ok  ' : 'WRONG'} ${entry.symbol.padEnd(9)} ${entry.accession} pos ${String(position).padStart(4)} ` +
      `seeded ref=${seededRef} actual=${actual} alt=${entry.featured.altAa} ` +
      `hgvs=${body.result.codon.hgvsP} ${body.result.codon.hgvsC} score=${body.result.score} ${body.result.verdict}` +
      (gene.gene.symbol !== entry.symbol ? `  [catalog symbol ${entry.symbol} vs UniProt ${gene.gene.symbol}]` : ''),
  );
}

console.log(`\n${wrong === 0 ? 'all featured positions agree with the retrieved CDS' : `${wrong} entr${wrong === 1 ? 'y' : 'ies'} disagree`}`);
process.exit(wrong === 0 ? 0 : 1);