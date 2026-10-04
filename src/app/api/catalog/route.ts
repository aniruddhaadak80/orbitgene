import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveGeneProfile } from '@/lib/services/assays';
import { isValidAccession } from '@/lib/sources/uniprot';
import { fail, ok, withOwner } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Resolving a gene can take twenty seconds on a cold cache, because every
 * candidate transcript is fetched and translated until one matches the UniProt
 * protein. The default serverless budget is shorter than that, and a request
 * killed mid-flight surfaces as "upstream unavailable", which blames UniProt for
 * our own timeout. The persistent profile cache means this budget is only ever
 * spent on the very first resolve of a given accession.
 */
export const maxDuration = 60;
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

    const profile = await resolveGeneProfile(accession, { fresh: refresh });

    /**
 * Annotations and sites are capped for payload size, but the caps are reported
 * alongside the arrays. Without the totals the UI has to choose between showing
 * only a subset while calling it the whole entry, or contradicting the source
 * note, which counts everything UniProt returned.
 */
const ANNOTATION_LIMIT = 80;
const SITE_LIMIT = 160;

    const sortedEvidence = [...profile.evidence].sort((a, b) => a.position - b.position);

    const annotated = sortedEvidence.slice(0, ANNOTATION_LIMIT).map((e) => ({
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
      sites: profile.sites.slice(0, SITE_LIMIT),
      siteTotal: profile.sites.length,
      annotated,
      annotatedTotal: sortedEvidence.length,
      annotatedLimit: ANNOTATION_LIMIT,
      sources: profile.sources,
    });
  });
}