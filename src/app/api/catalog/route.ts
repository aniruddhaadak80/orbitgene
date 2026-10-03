import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { loadGeneProfile } from '@/lib/sources/gene';
import { isValidAccession } from '@/lib/sources/uniprot';
import { fail, ok, withOwner } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reference catalogue and live gene context.
 *
 * With no accession it returns the seeded catalogue. With one it retrieves the
 * real UniProt entry and its coding sequence from RefSeq, and every source in the
 * response carries `live` or `fallback` so the UI can say which it is showing.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return withOwner(request, async () => {
    const url = new URL(request.url);
    const accession = url.searchParams.get('accession');
    const refresh = url.searchParams.get('fresh') === 'true';

    if (!accession) {
      const db = await getDb();
      const catalog = await db.query<{
        accession: string;
        symbol: string;
        name: string;
        blurb: string;
        featured_position: number;
        featured_ref_aa: string;
        featured_alt_aa: string;
      }>(
        `select accession, symbol, name, blurb, featured_position, featured_ref_aa, featured_alt_aa
         from gene_catalog order by sort_order asc`,
      );

      return ok({
        catalog: catalog.map((row) => ({
          accession: row.accession,
          symbol: row.symbol,
          name: row.name,
          blurb: row.blurb,
          featured: {
            proteinPosition: Number(row.featured_position),
            refAa: row.featured_ref_aa,
            altAa: row.featured_alt_aa,
          },
        })),
      });
    }

    if (!isValidAccession(accession.split('_')[0])) {
      return fail(400, 'invalid-accession', 'Provide a UniProt accession such as P38398.');
    }

    const profile = await loadGeneProfile(accession, { fresh: refresh });

    const annotated = [...profile.evidence]
      .sort((a, b) => a.position - b.position)
      .slice(0, 80)
      .map((e) => ({
        position: e.position,
        refAa: e.refAa,
        altAas: e.altAas,
        kind: e.source === 'uniprot-mutagenesis' ? 'mutagenesis' : 'natural-variant',
        description: e.description,
        publications: e.publications,
      }));

    return ok({
      gene: {
        accession: profile.gene.accession,
        entryName: profile.gene.entryName,
        symbol: profile.gene.geneSymbol,
        name: profile.gene.proteinName,
        organism: profile.gene.organism,
        reviewStatus: profile.gene.reviewStatus,
        proteinLength: profile.gene.proteinLength,
        refseqMrna: profile.gene.refseqMrna,
        cdsLength: profile.gene.cdsLength,
        sequenceChecksum: profile.gene.sequenceChecksum,
        fetchedAt: profile.gene.fetchedAt,
      },
      sites: profile.sites.slice(0, 160),
      annotated,
      sources: profile.sources,
    });
  });
}