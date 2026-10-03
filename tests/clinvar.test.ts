import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AA_NAMES, RESIDUES } from '@/lib/genetics';
import { clinVarSubstitutionQuery } from '@/lib/sources/ncbi';
import { classifyClinicalLookup } from '@/lib/services/assays';

describe('AA_NAMES', () => {
  it('covers every standard residue with a UniProt three-letter code', () => {
    for (const aa of RESIDUES) {
      assert.match(AA_NAMES[aa] ?? '', /^[A-Z][a-z]{2}$/, `${aa} has a three-letter name`);
    }
    assert.equal(Object.keys(AA_NAMES).filter((k) => k !== '*').length, 20);
  });

  it('names the stop codon', () => {
    assert.equal(AA_NAMES['*'], 'Ter');
  });

  it('matches ClinVar spelling for the residues that are easy to get wrong', () => {
    // ClinVar indexes these exact spellings, so a wrong one silently returns
    // "not reported" instead of the classification.
    assert.equal(AA_NAMES.I, 'Ile');
    assert.equal(AA_NAMES.L, 'Leu');
    assert.equal(AA_NAMES.R, 'Arg');
    assert.equal(AA_NAMES.Q, 'Gln');
    assert.equal(AA_NAMES.E, 'Glu');
  });
});

describe('clinVarSubstitutionQuery', () => {
  it('builds a gene-scoped three-letter protein-change query', () => {
    assert.equal(clinVarSubstitutionQuery('BRCA1', 'I', 26, 'F'), 'BRCA1[gene] AND Ile26Phe');
    assert.equal(clinVarSubstitutionQuery('TP53', 'R', 175, 'H'), 'TP53[gene] AND Arg175His');
    assert.equal(clinVarSubstitutionQuery('EGFR', 'L', 858, 'R'), 'EGFR[gene] AND Leu858Arg');
  });

  it('normalises case and surrounding whitespace', () => {
    assert.equal(clinVarSubstitutionQuery('  brca1 ', ' i ', 26, ' f '), 'BRCA1[gene] AND Ile26Phe');
  });

  it('scopes the term to the gene so a change in another gene cannot match', () => {
    const query = clinVarSubstitutionQuery('TP53', 'R', 175, 'H');
    assert.ok(query?.startsWith('TP53[gene] AND '));
    // The unscoped form is what a gene-wide count would look like, and it is
    // never what we want to assert.
    assert.notEqual(query, 'Arg175His');
  });

  it('returns null rather than a malformed query for unusable inputs', () => {
    assert.equal(clinVarSubstitutionQuery('', 'R', 175, 'H'), null);
    assert.equal(clinVarSubstitutionQuery('TP53', 'X', 175, 'H'), null, 'X is not an amino acid');
    assert.equal(clinVarSubstitutionQuery('TP53', 'R', 175, 'Z'), null);
    assert.equal(clinVarSubstitutionQuery('TP53', 'R', 0, 'H'), null, 'positions are 1-based');
    assert.equal(clinVarSubstitutionQuery('TP53', 'R', -3, 'H'), null);
    assert.equal(clinVarSubstitutionQuery('TP53', 'R', 1.5, 'H'), null, 'positions are integers');
    assert.equal(clinVarSubstitutionQuery('TP53', '', 175, 'H'), null);
  });

  it('rejects a stop codon in either position, because this is a missense lookup', () => {
    // ClinVar indexes nonsense changes as Gln72Ter, but there is no residue to
    // substitute, and AA_NAMES maps '*' to 'Ter', so an unguarded lookup would
    // happily query for Ter72Gln and report "no record found".
    assert.equal(clinVarSubstitutionQuery('TP53', 'Q', 72, '*'), null);
    assert.equal(clinVarSubstitutionQuery('TP53', '*', 1, 'A'), null);
  });
});
describe('classifyClinicalLookup', () => {
  const now = '2026-10-03T00:00:00.000Z';
  const hit = {
    accession: 'VCV000012374',
    accessionVersion: 'VCV000012374.2',
    title: 'NM_000546.6(TP53):c.524G>A',
    proteinChange: 'R175H',
    significance: 'Pathogenic',
    reviewStatus: 'reviewed by expert panel',
    lastEvaluated: '2024/09/06 00:00',
    trait: 'Li-Fraumeni syndrome',
    url: 'https://www.ncbi.nlm.nih.gov/clinvar/variation/VCV000012374/',
  };

  it('reports a classification it actually retrieved', () => {
    const result = classifyClinicalLookup({ hit, query: 'TP53[gene] AND Arg175His' }, now);
    assert.equal(result.status, 'reported');
    assert.equal(result.hit?.accession, 'VCV000012374');
    assert.equal(result.source.status, 'live');
    assert.match(result.source.note, /Pathogenic/);
    assert.match(result.source.note, /reviewed by expert panel/);
    assert.equal(result.source.url, hit.url);
  });

  it('says "not-reported" only when ClinVar was searched and held nothing', () => {
    const result = classifyClinicalLookup({ hit: null, query: 'TP53[gene] AND Gln72Ter' }, now);
    assert.equal(result.status, 'not-reported');
    assert.equal(result.hit, null);
    assert.equal(result.source.status, 'live');
    assert.match(result.source.note, /Absence of a record is not evidence/);
  });

  it('never reports an upstream failure as "not-reported"', () => {
    // This is the case that matters: NCBI rate-limits, and a lookup that was
    // never completed must not be indistinguishable from one that found nothing.
    const result = classifyClinicalLookup(
      { hit: null, query: 'TP53[gene] AND Arg175His', failure: 'HTTP 429 rate limited' },
      now,
    );
    assert.equal(result.status, 'unavailable');
    assert.equal(result.hit, null);
    assert.equal(result.source.status, 'fallback');
    assert.match(result.source.note, /upstream failure/);
    assert.match(result.source.note, /429/);
    assert.doesNotMatch(result.source.note, /Absence of a record/);
  });

  it('treats an unbuildable query as unavailable rather than unreported', () => {
    const result = classifyClinicalLookup({ hit: null, query: '' }, now);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.source.status, 'fallback');
  });

  it('keeps the three statuses distinct', () => {
    const statuses = new Set([
      classifyClinicalLookup({ hit, query: 'q' }, now).status,
      classifyClinicalLookup({ hit: null, query: 'q' }, now).status,
      classifyClinicalLookup({ hit: null, query: 'q', failure: 'boom' }, now).status,
    ]);
    assert.equal(statuses.size, 3);
  });
});