import { canonicalJson, sha256 } from './canonical';
import {
  applySubstitution,
  AA_NAMES,
  HYDROPATHY,
  isBase,
  isResidue,
  translateCodon,
  physicochemicalDisplacement,
  RESIDUE_CLASS,
  RESIDUE_VOLUME,
  formalCharge,
  round,
  substitutionsFor,
} from './genetics';
import { computeFlightBudget } from './radiation';
import { compareProbeThermodynamics, deriveProbe, oligoThermodynamics } from './thermo';
import type {
  AnnotatedSite,
  CodonAnalysis,
  EngineInput,
  EngineResult,
  Factor,
  FlightAnalysis,
  Gate,
  ProbeDesign,
  SignalAnalysis,
  StructuralAnalysis,
  ThermoAnalysis,
  Verdict,
} from './types';

export const ENGINE_VERSION = 'orbitgene/1.0.0' as const;

/**
 * Factor weights. They sum to exactly 1, and `score` is therefore just
 * 100 * sum(weight_i * support_i). A weight is never redistributed: an
 * unreadable factor reports `support = 0` and drags the score down instead of
 * silently reallocating influence to the factors that happened to work.
 */
export const FACTOR_WEIGHTS = Object.freeze({
  physicochemical: 0.2,
  signal: 0.18,
  structural: 0.16,
  thermo: 0.16,
  flight: 0.16,
  codon: 0.14,
});

const WEIGHT_SUM = Object.values(FACTOR_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(WEIGHT_SUM - 1) > 1e-9) {
  throw new Error(`factor weights must sum to 1, got ${WEIGHT_SUM}`);
}

/* ------------------------------------------------------------------ */
/* Physical constants                                                  */
/* ------------------------------------------------------------------ */

const PLANCK = 6.62607015e-34; // J*s
const C_LIGHT = 2.99792458e8; // m/s
const ELEMENTARY_CHARGE = 1.602176634e-19; // C
const GAS_CONSTANT = 8.314462618; // J/(mol*K)

/** Fluorescence hybridisation is run near physiological temperature. */
const ASSAY_TEMPERATURE_K = 310.15; // 37 C

/**
 * Fraction of the emitted fluorescence that reaches the detector: the
 * photodiode's solid angle over 4pi, times filter and cuvette transmittance. For
 * a millimetre-scale die a few centimetres from a 1 microlitre sample this works
 * out around 1e-5, which is what keeps a milliwatt LED from saturating a 12-bit
 * converter by five orders of magnitude.
 */
const COLLECTION_FRACTION = 1e-5;

export interface EngineError {
  ok: false;
  reason: string;
}

export type EngineOutcome =
  | { ok: true; result: EngineResult }
  | EngineError;

/* ------------------------------------------------------------------ */
/* Sub-calls                                                           */
/* ------------------------------------------------------------------ */

interface CandidateSubstitution {
  refBase: string;
  altBase: string;
  baseOffset: number;
  change: ReturnType<typeof applySubstitution>;
  deltaTm: number;
}

/**
 * Finds the single-nucleotide substitution(s) at `proteinPosition` that turn the
 * wild-type residue into `altAa`.
 *
 * When `forcedOffset` is given, only that base of the codon may change. That is
 * how the mutation scrub pins the exact nucleotide the visitor is looking at, so
 * the reported HGVS and melting temperature are the ones on screen rather than a
 * substituted stand-in.
 *
 * Otherwise every candidate is priced and the one that best preserves probe
 * thermodynamics wins, with ties broken by codon offset then alternate base. The
 * rule is deterministic, so the same inputs always select the same substitution.
 */
function chooseSubstitution(
  cds: string,
  proteinPosition: number,
  altAa: string,
  probeCfg: ProbeDesign,
  probeLengthNt: number,
  forcedOffset?: number,
): { chosen: CandidateSubstitution | null; considered: number; rejected: string | null } {
  const offset = (proteinPosition - 1) * 3;
  const codon = (cds ?? '').slice(offset, offset + 3).toUpperCase();
  if (codon.length !== 3 || ![...codon].every(isBase)) {
    return { chosen: null, considered: 0, rejected: 'codon is not a complete ACGT triplet' };
  }

  const probe = deriveProbe(cds, proteinPosition, probeLengthNt);
  const positions = forcedOffset === undefined ? [0, 1, 2] : [forcedOffset];

  if (forcedOffset !== undefined && (!Number.isInteger(forcedOffset) || forcedOffset < 0 || forcedOffset > 2)) {
    return { chosen: null, considered: 0, rejected: `codon base offset must be 0, 1 or 2` };
  }

  const candidates: CandidateSubstitution[] = [];

  for (const i of positions) {
    const refBase = codon[i];
    for (const altBase of substitutionsFor(refBase)) {
      // The codon offset is passed explicitly: for a homopolymeric codon such as
      // GGC, resolving the reference base by first occurrence would mutate the
      // wrong nucleotide and price the wrong melting temperature.
      const change = applySubstitution(cds, proteinPosition, refBase, altBase, i);
      if (!change.valid || change.altAa !== altAa) continue;
      const thermo = compareProbeThermodynamics(
        probe.sequence,
        probe.codonOffset + i,
        refBase,
        altBase,
        probeCfg.sodiumMolar,
        probeCfg.strandConcentrationNm,
      );
      candidates.push({ refBase, altBase, baseOffset: i, change, deltaTm: thermo.deltaTmC });
    }
  }

  if (candidates.length === 0) {
    const scope =
      forcedOffset === undefined
        ? `at codon ${proteinPosition}`
        : `at codon ${proteinPosition} base ${forcedOffset + 1} (${codon})`;
    return {
      chosen: null,
      considered: 0,
      rejected: `no single-nucleotide substitution ${scope} produces ${AA_NAMES[altAa] ?? altAa}`,
    };
  }

  candidates.sort((a, b) => {
    if (Math.abs(a.deltaTm) !== Math.abs(b.deltaTm)) {
      return Math.abs(a.deltaTm) - Math.abs(b.deltaTm);
    }
    if (a.baseOffset !== b.baseOffset) return a.baseOffset - b.baseOffset;
    return a.altBase.localeCompare(b.altBase);
  });

  return { chosen: candidates[0], considered: candidates.length, rejected: null };
}

function structuralAnalysis(
  sites: AnnotatedSite[],
  position: number,
  hasAnnotation: boolean,
): StructuralAnalysis {
  const notes: string[] = [];
  const enclosing =
    sites
      .filter((s) => position >= s.start && position <= s.end)
      .sort((a, b) => a.start - b.start || b.end - a.end)[0] ?? null;

  let support = 1;
  if (enclosing) {
    const span = enclosing.end - enclosing.start + 1;
    const offsetInSite = position - enclosing.start;
    switch (enclosing.type) {
      case 'Helix':
      case 'Beta strand':
        support = 0.45;
        notes.push(`position ${position} sits inside a UniProt-annotated ${enclosing.type.toLowerCase()} (${enclosing.start}-${enclosing.end})`);
        break;
      case 'Chain':
      case 'Region':
        support = 0.55;
        notes.push(`position ${position} sits inside a UniProt-annotated ${enclosing.type.toLowerCase()}`);
        break;
      case 'Domain':
      case 'Zinc finger':
      case 'Active site':
      case 'Binding site':
        support = 0.2;
        notes.push(`position ${position} sits inside a UniProt-annotated ${enclosing.type.toLowerCase()}${enclosing.description ? `: ${enclosing.description}` : ''}`);
        break;
      case 'Compositional bias':
        support = 0.5;
        notes.push('position falls in an annotated low-complexity region');
        break;
    }
    notes.push(`offset ${offsetInSite} of ${span} within the feature`);
  } else {
    notes.push('position lies outside every UniProt-annotated secondary-structure feature');
  }

  if (hasAnnotation) {
    // An experimentally or clinically annotated site is real evidence, which
    // lifts the structural floor slightly but never above the unannotated case.
    support = Math.min(1, support + 0.1);
    notes.push('UniProt carries a variant or mutagenesis annotation at this residue');
  } else {
    support = Math.max(0.3, support - 0.1);
    notes.push('no UniProt annotation covers this residue, so structure is inferred from flanking features only');
  }

  return {
    enclosing,
    offsetInSite: enclosing ? position - enclosing.start : null,
    support: round(support, 4),
    notes,
  };
}

function signalAnalysis(
  input: EngineInput,
  thermo: ThermoAnalysis,
  wtProbe: string,
): SignalAnalysis {
  const { instrument, probe } = input;

  const lambda = Math.max(1e-9, instrument.emitterNm) * 1e-9; // m
  const photonEnergy = (PLANCK * C_LIGHT) / lambda; // J

  const opticalPowerW = Math.max(0, instrument.emitterMw) * 1e-3;
  const excitation = opticalPowerW / photonEnergy; // photons/s delivered
  const emitted = excitation * Math.min(1, Math.max(0, instrument.quantumYield));
  const detectedPowerW = emitted * photonEnergy * COLLECTION_FRACTION;

  const photocurrentA = detectedPowerW * Math.max(0, instrument.detectorResponsivityAw);
  const darkA = Math.max(0, instrument.darkCurrentPa) * 1e-12;
  const t = Math.max(1e-6, instrument.integrationMs) * 1e-3;

  const signalCounts = (photocurrentA * t) / ELEMENTARY_CHARGE;
  const darkCounts = (darkA * t) / ELEMENTARY_CHARGE;

  // Shot-noise plus dark-current-limited SNR, expressed in photoelectrons.
  const shotSnr = signalCounts / Math.sqrt(Math.max(1e-9, signalCounts + darkCounts));

  // ADC quantum limit. The transimpedance amp turns photocurrent into a signal
  // voltage; quantisation noise is one LSB spread uniformly (sd = LSB/sqrt(12)),
  // so the achievable SNR is Vsignal * sqrt(12) / LSB. Saturation is checked by
  // comparing the signal voltage against the full-scale rail.
  const bits = Math.min(24, Math.max(4, Math.floor(instrument.adcBits)));
  const gain = Math.max(1e-6, instrument.gain);
  const fullScaleV = Math.max(0.001, instrument.adcFullScaleV);
  const signalVolts = photocurrentA * gain;
  const lsbV = fullScaleV / 2 ** bits;
  const saturated = signalVolts >= fullScaleV;
  const adcSnr = saturated ? 0 : (signalVolts * Math.sqrt(12)) / lsbV;

  const snr = Math.min(shotSnr, adcSnr);

  // Fold separation between the mutant and wild-type hybrid populations from the
  // free-energy difference of the two probes at the assay temperature:
  //   [mutant]/[wild type] = exp( -(dG_mut - dG_wt) / (R T) )
  // A ratio below one just means the mutant hybridises worse than the wild type,
  // which a fluorescence readout discriminates just as well, so the reported
  // margin is the fold difference in whichever direction it falls.
  let discriminationMargin = 1;
  const wtThermo = oligoThermodynamics(wtProbe, probe.sodiumMolar, probe.strandConcentrationNm);
  const mutThermo = oligoThermodynamics(thermo.probe, probe.sodiumMolar, probe.strandConcentrationNm);

  if (wtThermo.valid && mutThermo.valid) {
    const deltaGwt = wtThermo.deltaH * 1000 - ASSAY_TEMPERATURE_K * wtThermo.deltaS;
    const deltaGmut = mutThermo.deltaH * 1000 - ASSAY_TEMPERATURE_K * mutThermo.deltaS;
    const exponent = -(deltaGmut - deltaGwt) / (GAS_CONSTANT * ASSAY_TEMPERATURE_K);
    discriminationMargin = Math.exp(Math.min(60, Math.abs(exponent)));
  }

  // The detector question is asked here and only here: can this optics chain
  // resolve *any* difference at all? Whether the difference is large enough to
  // matter is the thermo factor's question. Folding both into one gate made the
  // two factors contradict each other, since a large dTm that makes a probe
  // discriminating is the same dTm that would push it past the usable window.
  let cls: SignalAnalysis['class'];
  if (saturated) cls = 'unresolved';
  else if (snr >= 3) cls = 'resolves';
  else if (snr >= 1.5) cls = 'marginal';
  else cls = 'unresolved';

  return {
    excitationPhotonsPerSecond: round(excitation, 1),
    signalCounts: round(signalCounts, 2),
    darkCounts: round(darkCounts, 3),
    adcSnr: round(adcSnr, 3),
    shotSnr: round(shotSnr, 3),
    snr: round(snr, 3),
    discriminationMargin: round(discriminationMargin, 3),
    class: cls,
  };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

const CONSEQUENCE_SUPPORT: Record<string, number> = {
  synonymous: 0.9,
  missense: 0.5,
  nonsense: 0.05,
  'start-loss': 0.05,
  'stop-loss': 0.1,
  frameshift: 0.05,
  invalid: 0,
};

const THERMO_SUPPORT = { usable: 1, marginal: 0.5, inert: 0, broken: 0 } as const;
const SIGNAL_SUPPORT = { resolves: 1, marginal: 0.45, unresolved: 0 } as const;
const FLIGHT_SUPPORT = { cleared: 1, marginal: 0.4, fails: 0 } as const;

/**
 * Scores one substitution against one assay configuration and one radiation
 * environment. Pure: no I/O, no clock, no randomness. The only non-derived input
 * is the space-weather observation supplied by the caller, so the same snapshot
 * always yields byte-identical output.
 */
export function scoreMutation(input: EngineInput): EngineOutcome {
  const { profile, proteinPosition, refAa, altAa, instrument, flight, probe, spaceWeather } = input;
  const cds = profile.gene.cds;

  if (!cds) {
    return { ok: false, reason: 'no coding sequence is available for this gene' };
  }
  if (!isResidue(refAa)) {
    return { ok: false, reason: `reference residue must be a one-letter amino-acid code, received "${refAa}"` };
  }
  if (!isResidue(altAa)) {
    return { ok: false, reason: `alternate residue must be a one-letter amino-acid code, received "${altAa}"` };
  }

  const probeLengthNt = instrument.probeLengthNt ?? 21;
  const codonOffset = (proteinPosition - 1) * 3;
  const wildTypeCodon = cds.slice(codonOffset, codonOffset + 3).toUpperCase();

  // Validate the caller's stated wild-type residue against the codon before doing
  // any substitution search, so a mistyped reference reports the real mismatch
  // instead of the less useful "no substitution produces X".
  const observedRefAa = translateCodon(wildTypeCodon);
  if (observedRefAa !== 'X' && observedRefAa !== refAa) {
    return {
      ok: false,
      reason: `wild-type residue at position ${proteinPosition} is ${AA_NAMES[observedRefAa] ?? observedRefAa}, not ${AA_NAMES[refAa] ?? refAa}`,
    };
  }

  const selection = chooseSubstitution(cds, proteinPosition, altAa, probe, probeLengthNt, input.baseOffset);
  if (!selection.chosen) {
    return {
      ok: false,
      reason: selection.rejected ?? 'no single-nucleotide substitution produces the requested residue change',
    };
  }

  const chosen = selection.chosen;
  const probeWindow = deriveProbe(cds, proteinPosition, probeLengthNt);

  const thermo: ThermoAnalysis = compareProbeThermodynamics(
    probeWindow.sequence,
    probeWindow.codonOffset + chosen.baseOffset,
    chosen.refBase,
    chosen.altBase,
    probe.sodiumMolar,
    probe.strandConcentrationNm,
  );

  const codon: CodonAnalysis = {
    refCodon: chosen.change.refCodon,
    altCodon: chosen.change.altCodon,
    codonIndex: chosen.change.codonIndex,
    hgvsC: chosen.change.hgvsC,
    hgvsP: chosen.change.hgvsP,
    refAa: chosen.change.refAa,
    altAa: chosen.change.altAa,
    transition: chosen.change.transition,
    consequence: chosen.change.consequence,
    atTerminalCodon: chosen.change.atTerminalCodon,
    baseOffset: chosen.baseOffset,
    refBase: chosen.refBase,
    altBase: chosen.altBase,
  };

  const signal = signalAnalysis(input, thermo, probeWindow.sequence);

  const budget: FlightAnalysis = computeFlightBudget({
    shieldingMgPerCm2: flight.shieldingMgPerCm2,
    missionDays: flight.missionDays,
    altitudeKm: flight.altitudeKm,
    inclinationDeg: flight.inclinationDeg,
    sramBitsMb: flight.sramBitsMb,
    readoutVoting: flight.readoutVoting,
    weather: spaceWeather,
  });

  const annotations = profile.evidence.filter((e) => e.position === proteinPosition);
  const structural = structuralAnalysis(profile.sites, proteinPosition, annotations.length > 0);

  // A nonsense, start-loss or stop-loss change truncates the product rather than
  // swapping a side chain, so the residue scale has nothing meaningful to say.
  // Rating it through the physicochemical axes would report a ter as if it were
  // an ordinary missense partner.
  const truncating = codon.consequence !== 'missense' && codon.consequence !== 'synonymous';
  const displacement = truncating ? 0.9 : physicochemicalDisplacement(refAa, altAa);
  const physicochemicalSupport = round(Math.max(0, 1 - displacement), 4);

  const codonSupport = CONSEQUENCE_SUPPORT[codon.consequence] ?? 0;
  const thermoSupport = THERMO_SUPPORT[thermo.class];
  const signalSupport = SIGNAL_SUPPORT[signal.class];
  const flightSupport = FLIGHT_SUPPORT[budget.class];
  const structuralSupport = structural.support;

  const classChange = RESIDUE_CLASS[refAa] !== RESIDUE_CLASS[altAa];

  const factors: Factor[] = [
    {
      key: 'physicochemical',
      label: 'Physicochemical displacement',
      weight: FACTOR_WEIGHTS.physicochemical,
      support: physicochemicalSupport,
      contribution: round(FACTOR_WEIGHTS.physicochemical * physicochemicalSupport, 4),
      summary:
        codon.consequence === 'synonymous'
          ? `silent: ${AA_NAMES[refAa]} becomes ${AA_NAMES[altAa]} with no side-chain change`
          : truncating
            ? `${codon.consequence}: the chain is truncated at residue ${proteinPosition}, so no side-chain comparison applies`
            : `${AA_NAMES[refAa]} to ${AA_NAMES[altAa]} moves the side chain ${(displacement * 100).toFixed(1)}% of the maximum axis displacement`,
      evidence: [
        {
          label: 'Kyte-Doolittle hydropathy',
          value: truncating ? 'not applicable (truncating change)' : `${hydropathyLabel(refAa)} to ${hydropathyLabel(altAa)}`,
        },
        {
          label: 'Zamyatnin volume',
          value: truncating ? 'not applicable (truncating change)' : `${volumeLabel(refAa)} to ${volumeLabel(altAa)} A^3`,
        },
        { label: 'Formal charge', value: truncating ? 'not applicable' : `${chargeLabel(refAa)} to ${chargeLabel(altAa)}` },
        {
          label: 'Residue class change',
          value: truncating ? 'not applicable' : classChange ? `yes (${RESIDUE_CLASS[refAa]} to ${RESIDUE_CLASS[altAa]})` : 'no',
        },
      ],
    },
    {
      key: 'signal',
      label: 'Assay signal budget',
      weight: FACTOR_WEIGHTS.signal,
      support: signalSupport,
      contribution: round(FACTOR_WEIGHTS.signal * signalSupport, 4),
      summary: `SNR ${signal.snr.toFixed(2)} over a ${instrument.integrationMs} ms window resolves a ${signal.discriminationMargin.toFixed(2)}x mutant/wild-type separation`,
      evidence: [
        { label: 'Signal counts', value: `${signal.signalCounts.toFixed(1)} e-` },
        { label: 'Shot SNR', value: signal.shotSnr.toFixed(2) },
        { label: 'ADC SNR', value: `${signal.adcSnr.toFixed(2)} at ${instrument.adcBits} bits` },
        { label: 'Fold separation', value: `${signal.discriminationMargin.toFixed(3)}x` },
      ],
    },
    {
      key: 'structural',
      label: 'Structural context',
      weight: FACTOR_WEIGHTS.structural,
      support: structuralSupport,
      contribution: round(FACTOR_WEIGHTS.structural * structuralSupport, 4),
      summary: structural.enclosing
        ? `inside annotated ${structural.enclosing.type.toLowerCase()} ${structural.enclosing.start}-${structural.enclosing.end}`
        : 'outside every annotated structural feature',
      evidence: structural.notes.map((n) => ({ label: 'Annotation', value: n })),
    },
    {
      key: 'thermo',
      label: 'Probe thermodynamics',
      weight: FACTOR_WEIGHTS.thermo,
      support: thermoSupport,
      contribution: round(FACTOR_WEIGHTS.thermo * thermoSupport, 4),
      summary: `nearest-neighbour dTm ${thermo.deltaTmC.toFixed(2)} C moves the ${probeWindow.length} nt probe from ${thermo.wtTmC.toFixed(2)} C to ${thermo.mutTmC.toFixed(2)} C (${thermo.class})`,
      evidence: [
        { label: 'Probe window', value: probeWindow.sequence },
        { label: 'Mutant probe', value: thermo.probe },
        { label: 'GC fraction', value: `${(thermo.gcFraction * 100).toFixed(1)}%` },
        { label: 'Delta G (wild type)', value: `${thermo.wtDeltaG} kcal/mol` },
        { label: 'Substitutions priced', value: `${selection.considered} candidate(s) produce ${AA_NAMES[altAa]}; cheapest probe delta Tm chosen` },
      ],
    },
    {
      key: 'flight',
      label: 'Radiation integrity',
      weight: FACTOR_WEIGHTS.flight,
      support: flightSupport,
      contribution: round(FACTOR_WEIGHTS.flight * flightSupport, 4),
      summary: `${budget.totalDoseKrad.toFixed(3)} krad(Si) over ${flight.missionDays} d behind ${flight.shieldingMgPerCm2} mg/cm2 needs ${Number.isFinite(budget.requiredVoting) ? budget.requiredVoting : 'unbounded'} redundant readouts, ${flight.readoutVoting} supplied`,
      evidence: [
        { label: 'GCR dose rate', value: `${budget.gcrDoseRateRadDay} rad(Si)/day` },
        { label: 'SPE dose rate', value: `${budget.speDoseRateRadDay} rad(Si)/day at ${spaceWeather.protonFluxPfu} pfu` },
        { label: 'Planetary K', value: `${spaceWeather.kpIndex} (${spaceWeather.kpLabel})` },
        { label: 'Expected upsets', value: `${budget.expectedUpsets}` },
        { label: 'Required voting', value: Number.isFinite(budget.requiredVoting) ? String(budget.requiredVoting) : 'unbounded' },
      ],
    },
    {
      key: 'codon',
      label: 'Codon consequence',
      weight: FACTOR_WEIGHTS.codon,
      support: codonSupport,
      contribution: round(FACTOR_WEIGHTS.codon * codonSupport, 4),
      summary: `${codon.hgvsC} turns codon ${codon.refCodon} into ${codon.altCodon}, a ${codon.consequence} change${codon.transition ? ' by transition' : ''}`,
      evidence: [
        { label: 'HGVS c.', value: codon.hgvsC },
        { label: 'HGVS p.', value: codon.hgvsP },
        { label: 'RefSeq mRNA', value: profile.gene.refseqMrna },
        { label: 'CDS length', value: `${profile.gene.cdsLength} nt` },
      ],
    },
  ];

  const gates: Gate[] = [
    {
      id: 'probe-binds',
      passed: thermo.class === 'usable' || thermo.class === 'marginal',
      detail:
        thermo.class === 'broken'
          ? `|dTm| of ${Math.abs(thermo.deltaTmC).toFixed(2)} C exceeds 4.5 C, so the mismatch destroys the duplex; redesign the oligo`
          : thermo.class === 'inert'
            ? `|dTm| of ${Math.abs(thermo.deltaTmC).toFixed(2)} C is under 0.5 C, so the mismatch leaves the duplex unchanged and nothing can separate it`
            : `|dTm| of ${Math.abs(thermo.deltaTmC).toFixed(2)} C sits inside the 0.5 to 4.5 C discrimination window`,
    },
    {
      id: 'signal-resolves',
      passed: signal.class === 'resolves',
      detail: `optics deliver an SNR of ${signal.snr.toFixed(2)} over a ${instrument.integrationMs} ms window, which is enough to read the signal when the amplifier is not over-driven`,
    },
    {
      id: 'flight-cleared',
      passed: budget.class === 'cleared',
      detail:
        budget.class === 'cleared'
          ? `${flight.readoutVoting} redundant readouts meets the 1e-3 upset budget`
          : `${flight.readoutVoting} redundant readouts is below the ${budget.requiredVoting} required`,
    },
    {
      id: 'structural-clear',
      passed: structuralSupport >= 0.5,
      detail: structural.enclosing
        ? `support ${structuralSupport.toFixed(2)} inside ${structural.enclosing.type.toLowerCase()}${structuralSupport >= 0.5 ? ' with a curated annotation' : ' and no curated annotation'}, threshold 0.50`
        : `support ${structuralSupport.toFixed(2)} outside every annotated feature, threshold 0.50`,
    },
    {
      id: 'evidence-present',
      passed: annotations.length > 0,
      detail:
        annotations.length > 0
          ? `${annotations.length} UniProt annotation(s) cover this residue`
          : 'no UniProt variant or mutagenesis annotation covers this residue',
    },
  ];

  const weighted = factors.reduce((acc, f) => acc + f.weight * f.support, 0);
  const score = round(Math.max(0, Math.min(100, weighted * 100)), 2);

  const gatePassed = (id: string): boolean => gates.find((g) => g.id === id)?.passed ?? false;

  let verdict: Verdict;
  if (!gatePassed('probe-binds')) {
    verdict = 'REDESIGN-PROBE';
  } else if (
    !gatePassed('flight-cleared') ||
    !gatePassed('signal-resolves') ||
    !gatePassed('structural-clear')
  ) {
    verdict = 'GROUND-ONLY';
  } else if (score < 70) {
    verdict = 'HOLD-FOR-EVIDENCE';
  } else if (!gatePassed('evidence-present')) {
    // The physics all clears, but nothing in the curated annotation covers this
    // residue, so there is no published reason to believe the substitution
    // matters. That is exactly what "hold for evidence" means.
    verdict = 'HOLD-FOR-EVIDENCE';
  } else {
    verdict = 'FLIGHT-GO';
  }

  const inputDigest = sha256(
    canonicalJson({
      engine: ENGINE_VERSION,
      accession: profile.gene.accession,
      checksum: profile.gene.sequenceChecksum,
      proteinPosition,
      refAa,
      altAa,
      instrument,
      flight,
      probe,
      weather: {
        kpIndex: spaceWeather.kpIndex,
        protonFluxPfu: spaceWeather.protonFluxPfu,
        xrayClass: spaceWeather.xrayClass,
        observationTime: spaceWeather.observationTime,
      },
    }),
  );

  return {
    ok: true,
    result: {
      engine: ENGINE_VERSION,
      score,
      verdict,
      gates,
      factors,
      codon,
      thermo,
      signal,
      flight: budget,
      structural,
      inputDigest,
    },
  };
}

/* Label helpers kept next to the engine so the factor ledger reads cleanly. */
function hydropathyLabel(aa: string): string {
  const v = HYDROPATHY[aa];
  return v === undefined ? 'n/a' : v.toFixed(1);
}
function volumeLabel(aa: string): string {
  const v = RESIDUE_VOLUME[aa];
  return v === undefined ? 'n/a' : v.toFixed(1);
}
function chargeLabel(aa: string): string {
  const q = formalCharge(aa);
  return q > 0 ? `+${q}` : `${q}`;
}