import { loadGeneProfile } from '@/lib/sources/gene';
import { loadSpaceWeather } from '@/lib/sources/spaceweather';
async function step(label: string, fn: () => Promise<unknown>) {
  const t = Date.now();
  try {
    const v = (await fn()) as Record<string, unknown>;
    console.log(`OK   ${label} in ${Date.now() - t}ms`, JSON.stringify(v).slice(0, 240));
  } catch (e) { console.log(`FAIL ${label} in ${Date.now() - t}ms ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
}
async function main() {
  await step('weather', async () => {
    const w = await loadSpaceWeather();
    return { kp: w.kpIndex, status: w.sources.map((s) => s.status).join('+') };
  });
  for (const acc of ['P38398', 'P04637', 'P00533', 'P42224', 'P31946']) {
    await step(`gene ${acc}`, async () => {
      const g = await loadGeneProfile(acc);
      return { sym: g.gene.geneSymbol, mrna: g.gene.refseqMrna, cds: g.gene.cdsLength, aa: g.gene.proteinLength, sites: g.sites.length, ann: g.evidence.length, status: g.sources.map((s) => s.status).join('+'), note: g.sources[1]?.note?.slice(-60) };
    });
  }
}
void main();