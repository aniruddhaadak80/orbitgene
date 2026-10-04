const B = process.argv[2] ?? 'http://localhost:3210';
const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY';

const catalog = await (await fetch(`${B}/api/catalog`)).json();

console.log('accession  uniProtSymbol pos  ref  reachable   seeded');
console.log('-'.repeat(92));

for (const entry of catalog.catalog) {
  const gene = await (await fetch(`${B}/api/catalog?accession=${entry.accession}`)).json();
  const position = entry.featured.proteinPosition;

  let ref = null;
  const reachable = [];

  for (const alt of RESIDUES) {
    const attempt = await fetch(`${B}/api/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accession: entry.accession, proteinPosition: position, altAa: alt }),
    });
    const result = await attempt.json();
    if (attempt.ok && result.result) {
      ref ??= result.result.codon.refAa;
      if (alt !== ref) reachable.push(alt);
    }
  }

  if (ref === null) {
    console.log(`${entry.accession} pos ${position}: no reachable substitution at all`);
    continue;
  }

  const refOk = entry.featured.refAa === ref;
  const altOk = reachable.includes(entry.featured.altAa);

  console.log(
    `${entry.accession} ${(gene.gene.symbol ?? '?').padEnd(11)} ${String(position).padStart(5)}  ${ref}   ` +
      `${reachable.join('').padEnd(11)}${refOk && altOk ? 'ok' : `WRONG seed=${entry.symbol} ${entry.featured.refAa}->${entry.featured.altAa}`}`,
  );
}