import { NextResponse } from 'next/server';
import { readSettings } from '@/lib/session';
import { score } from '@/lib/services/assays';
import { scoreRequestSchema } from '@/lib/validation';
import { fail, fromValidation, ok, withOwner } from '@/lib/http';
import { substitutionDial } from '@/lib/genetics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Scores a substitution without persisting anything.
 *
 * This is what the mutation scrub calls on every change, so the response carries
 * the whole engine result plus the substitution dial for that codon, letting the
 * scrubber redraw the full factor ledger without a round trip to the database.
 */
export async function POST(request: Request): Promise<NextResponse> {
  return withOwner(request, async (ownerId) => {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail(400, 'invalid-json', 'The request body was not valid JSON.');
    }

    const parsed = scoreRequestSchema.safeParse(body);
    if (!parsed.success) return fromValidation(parsed.error);

    const baseOffset =
      typeof body.baseOffset === 'number' && Number.isInteger(body.baseOffset)
        ? (body.baseOffset as number)
        : undefined;
    if (baseOffset !== undefined && (baseOffset < 0 || baseOffset > 2)) {
      return fail(400, 'invalid-base-offset', 'baseOffset must be 0, 1 or 2.');
    }

    const settings = await readSettings(ownerId);

    const { outcome, profile, weather, clinical } = await score({
      accession: parsed.data.accession,
      proteinPosition: parsed.data.proteinPosition,
      refAa: parsed.data.refAa,
      altAa: parsed.data.altAa,
      baseOffset,
      instrumentId: parsed.data.instrumentId || settings.instrument.id,
      flightProfileId: parsed.data.flightProfileId || settings.flight.id,
    }, { fresh: body.fresh === true });

    if (!outcome.ok) {
      return fail(422, 'not-scorable', outcome.reason);
    }

    return ok({
      result: outcome.result,
      dial: substitutionDial(profile.gene.cds, parsed.data.proteinPosition),
      gene: {
        accession: profile.gene.accession,
        symbol: profile.gene.geneSymbol,
        name: profile.gene.proteinName,
        proteinLength: profile.gene.proteinLength,
        refseqMrna: profile.gene.refseqMrna,
        cdsLength: profile.gene.cdsLength,
        sequenceChecksum: profile.gene.sequenceChecksum,
      },
      weather: {
        kpIndex: weather.kpIndex,
        kpLabel: weather.kpLabel,
        protonFluxPfu: weather.protonFluxPfu,
        xrayClass: weather.xrayClass,
        observationTime: weather.observationTime,
      },
      clinical: {
        status: clinical.status,
        query: clinical.query,
        hit: clinical.hit,
        source: clinical.source,
      },
      sources: [...profile.sources, clinical.source],
    });
  });
}