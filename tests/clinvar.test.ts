import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AA_NAMES, RESIDUES } from '@/lib/genetics';
import { clinVarSubstitutionQuery } from '@/lib/sources/ncbi';

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