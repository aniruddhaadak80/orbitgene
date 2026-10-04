import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { GeneProfile } from '@/lib/types';
import { referenceMismatchReason } from '@/lib/services/assays';

/**
 * A minimal profile whose CDS is the first 30 codons of `ATG GCT TTT ...` is not
 * needed here: the guard only reads the codon at the requested position, so a
 * hand-written CDS with known residues is enough and keeps the test honest.
 */
function profileWithCds(cds: string): GeneProfile {
  return {
    gene: {
      accession: 'P00001',
      entryName: 'TEST_HUMAN',
      geneSymbol: 'TESTG',
      proteinName: 'Test protein',
      organism: 'Homo sapiens',
      reviewStatus: 'reviewed',
      proteinLength: Math.floor(cds.length / 3),
      sequence: '',
      sequenceChecksum: 'test',
      refseqMrna: 'NM_000001.1',
      cds,
      cdsLength: cds.length,
      fetchedAt: '2026-10-03T00:00:00.000Z',
    },
    sites: [],
    evidence: [],
    sources: [],
  };
}

// ATG=G(Met) GCT=A(Ala) TTT=F(Phe) GAA=E(Glu) TGT=C(Cys)
const PROFILE = profileWithCds('ATGGCTTTTGAA');

describe('referenceMismatchReason', () => {
  it('accepts a reference that matches the retrieved coding sequence', () => {
    for (const [position, aa] of [
      [1, 'M'],
      [2, 'A'],
      [3, 'F'],
      [4, 'E'],
      [5, 'C'],
    ] as const) {
      assert.equal(referenceMismatchReason(PROFILE, position, aa), null, `position ${position}`);
    }
  });

  it('is case insensitive', () => {
    assert.equal(referenceMismatchReason(PROFILE, 2, 'a'), null);
    assert.equal(referenceMismatchReason(PROFILE, 2, ' A '), null);
  });

  it('rejects a reference the sequence does not encode', () => {
    const reason = referenceMismatchReason(PROFILE, 2, 'V');
    assert.ok(reason, 'a mismatch must produce a reason');
    assert.match(reason, /Position 2 of TESTG is A/);
    assert.match(reason, /not V/);
    assert.match(reason, /NM_000001\.1/);
    // The reason has to make clear that scoring anyway would be wrong.
    assert.match(reason, /does not exist/);
  });

  it('does not invent a reference when none was supplied', () => {
    assert.equal(referenceMismatchReason(PROFILE, 2, undefined), null);
    assert.equal(referenceMismatchReason(PROFILE, 2, ''), null);
  });

  it('stays quiet when the position is outside the sequence', () => {
    // A position past the end has no codon to check, so there is nothing to
    // contradict. The engine reports the out-of-range position separately.
    assert.equal(referenceMismatchReason(PROFILE, 999, 'V'), null);
    assert.equal(referenceMismatchReason(PROFILE, 0, 'V'), null);
  });

  it('stays quiet when the codon cannot be translated', () => {
    const ambiguous = profileWithCds('ATGNNNTTTTGA');
    assert.equal(referenceMismatchReason(ambiguous, 2, 'V'), null);
  });
});