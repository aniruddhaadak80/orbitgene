import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { loadSpaceWeather } from '@/lib/sources/spaceweather';
import { computeFlightBudget } from '@/lib/radiation';
import { FLIGHT_PRESETS, findFlight } from '@/lib/profiles';
import { ok, withOwner } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Live space weather plus the radiation budget it implies for each flight preset.
 *
 * The budgets come from the same `computeFlightBudget` the engine calls, so this
 * page can never disagree with a stored record. Only the *inputs* live here; the
 * arithmetic stays in one place.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return withOwner(request, async () => {
    const url = new URL(request.url);
    const profileId = url.searchParams.get('profile');

    await getDb();
    const weather = await loadSpaceWeather();

    const presets = FLIGHT_PRESETS.map((flight) => ({
      id: flight.id,
      name: flight.name,
      altitudeKm: flight.altitudeKm,
      inclinationDeg: flight.inclinationDeg,
      missionDays: flight.missionDays,
      shieldingMgPerCm2: flight.shieldingMgPerCm2,
      sramBitsMb: flight.sramBitsMb,
      readoutVoting: flight.readoutVoting,
      budget: computeFlightBudget({
        shieldingMgPerCm2: flight.shieldingMgPerCm2,
        missionDays: flight.missionDays,
        altitudeKm: flight.altitudeKm,
        inclinationDeg: flight.inclinationDeg,
        sramBitsMb: flight.sramBitsMb,
        readoutVoting: flight.readoutVoting,
        weather,
      }),
    }));

    const selected = findFlight(profileId ?? presets[0].id);
    const selectedBudget = computeFlightBudget({
      shieldingMgPerCm2: selected.shieldingMgPerCm2,
      missionDays: selected.missionDays,
      altitudeKm: selected.altitudeKm,
      inclinationDeg: selected.inclinationDeg,
      sramBitsMb: selected.sramBitsMb,
      readoutVoting: selected.readoutVoting,
      weather,
    });

    return ok({
      weather,
      presets,
      selected: { ...selected, budget: selectedBudget },
    });
  });
}