/**
 * ORBITER domain types.
 *
 * Every external record is normalised into these shapes before it touches the
 * engine, the database or the UI, so that a live upstream response and a sealed
 * fallback response are structurally indistinguishable to consumers and only
 * differ by their `sources[].status`.
 */

export type SourceStatus = 'live' | 'fallback';

export interface SourceMeta {
  /** Stable machine id, e.g. `uniprot`. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  status: SourceStatus;
  /** Canonical URL of the upstream resource. */
  url: string;
  /** ISO-8601 retrieval time. */
  fetchedAt: string;
  /** Honest note about what was actually retrieved. */
  note: string;
}

export type SiteType =
  | 'Helix'
  | 'Beta strand'
  | 'Region'
  | 'Domain'
  | 'Chain'
  | 'Zinc finger'
  | 'Compositional bias'
  | 'Active site'
  | 'Binding site';

export interface AnnotatedSite {
  type: SiteType;
  start: number;
  end: number;
  description: string;
}

export interface VariantEvidence {
  source: 'uniprot-natural-variant' | 'uniprot-mutagenesis';
  position: number;
  refAa: string;
  altAas: string[];
  description: string;
  publications: string[];
}

export interface GeneRef {
  accession: string;
  entryName: string;
  geneSymbol: string;
  proteinName: string;
  organism: string;
  reviewStatus: 'reviewed' | 'unreviewed';
  proteinLength: number;
  sequence: string;
  /** sha256 of the sequence, truncated. Proves which sequence was scored. */
  sequenceChecksum: string;
  /** RefSeq mRNA accession whose CDS was retrieved. */
  refseqMrna: string;
  cds: string;
  cdsLength: number;
  fetchedAt: string;
}

export interface GeneProfile {
  gene: GeneRef;
  sites: AnnotatedSite[];
  evidence: VariantEvidence[];
  sources: SourceMeta[];
}

export interface ClinVarRecord {
  accession: string;
  title: string;
  significance: string;
  reviewStatus: string;
  sources: SourceMeta[];
}

/**
 * ClinVar's classification of one exact substitution.
 *
 * `reported` and `not-reported` are deliberately different outcomes, and
 * `unavailable` is a third: a ClinVar outage must never be displayed as though
 * the variant had been searched for and found unremarkable.
 */
export interface ClinicalContext {
  status: 'reported' | 'not-reported' | 'unavailable';
  /** The ClinVar query that was run, e.g. `TP53[gene] AND Arg175His`. */
  query: string;
  hit: ClinVarSubstitution | null;
  source: SourceMeta;
}

export interface ClinVarSubstitution {
  /** ClinVar variation accession, e.g. `VCV000012374`. */
  accession: string;
  accessionVersion: string;
  /** ClinVar's own title, e.g. `NM_000546.6(TP53):c.524G>A`. */
  title: string;
  /** Compact protein change as ClinVar stores it, e.g. `R175H`. */
  proteinChange: string | null;
  /** Germline classification, e.g. `Pathogenic`. */
  significance: string;
  /** ClinVar review status, e.g. `reviewed by expert panel`. */
  reviewStatus: string;
  /** Last date the classification was evaluated, as ClinVar reports it. */
  lastEvaluated: string;
  /** MedGen trait name when ClinVar records one. */
  trait: string | null;
  url: string;
}

export interface SpaceWeather {
  /** Planetary K index, 0..9. */
  kpIndex: number;
  kpLabel: string;
  /** GOES primary X-ray flux class: A, B, C, M, X. */
  xrayClass: string;
  xrayWattsPerM2: number;
  /** Integral >1 MeV proton flux, pfu. */
  protonFluxPfu: number;
  /** NOAA solar wind speed km/s when reported. */
  solarWindSpeedKms: number | null;
  observationTime: string;
  sources: SourceMeta[];
}

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface InstrumentProfile {
  id: string;
  name: string;
  /** LED centre wavelength in nanometres. */
  emitterNm: number;
  /** Optical output at the sample in milliwatts. */
  emitterMw: number;
  /** Photodiode responsivity in amps per watt. */
  detectorResponsivityAw: number;
  /** Detector dark current in picoamps. */
  darkCurrentPa: number;
  /** Transimpedance amplifier gain, V/A. */
  gain: number;
  /** ADC resolution in bits. */
  adcBits: number;
  /** ADC full-scale rail in volts. */
  adcFullScaleV: number;
  /** Integration time per sample in milliseconds. */
  integrationMs: number;
  /** Fluorophore quantum yield. */
  quantumYield: number;
  /** Sample volume in microlitres, recorded for the dossier only. */
  volumeUl: number;
  /** Annealing probe length in nucleotides, 15 to 40. */
  probeLengthNt: number;
}

export interface FlightProfile {
  id: string;
  name: string;
  /** Cruising altitude in kilometres. */
  altitudeKm: number;
  /** Orbit inclination in degrees. */
  inclinationDeg: number;
  /** Mission duration in days. */
  missionDays: number;
  /** Shielding areal density in mg/cm2 of aluminium equivalent. */
  shieldingMgPerCm2: number;
  /** Sample-buffer SRAM bits exposed to the dose. */
  sramBitsMb: number;
  /** Number of independent readouts written per measurement. */
  readoutVoting: number;
}

export interface ProbeDesign {
  /** Annealing half of the oligo, 5' to 3'. */
  sequence: string;
  /** Sodium concentration in mol/litre. */
  sodiumMolar: number;
  /** Total strand concentration in nanomolar. */
  strandConcentrationNm: number;
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export type Consequence =
  | 'synonymous'
  | 'missense'
  | 'nonsense'
  | 'start-loss'
  | 'stop-loss'
  | 'frameshift'
  | 'invalid';

export interface CodonAnalysis {
  refCodon: string;
  altCodon: string;
  codonIndex: number;
  /** HGVS c. notation, 1-based. */
  hgvsC: string;
  hgvsP: string;
  refAa: string;
  altAa: string;
  transition: boolean;
  consequence: Consequence;
  /** True when the changed codon overlaps a start or stop codon. */
  atTerminalCodon: boolean;
  /** Zero-based position inside the codon that changed, so the exact nucleotide is known. */
  baseOffset: number;
  /** Reference base at that position. */
  refBase: string;
  /** Alternate base at that position. */
  altBase: string;
}

export interface ThermoAnalysis {
  /** Wild-type probe window. */
  wtProbe: string;
  /** Same window with the single substituted base. */
  probe: string;
  wtTmC: number;
  mutTmC: number;
  deltaTmC: number;
  wtDeltaG: number;
  mutDeltaG: number;
  gcFraction: number;
  /**
   * `usable`  the mismatch shifts the duplex by enough to discriminate
   * `marginal` the shift is large enough to start costing hybridisation
   * `inert`   the mismatch barely perturbs the duplex, so nothing separates it
   * `broken`  the mismatch destroys the duplex outright
   *
   * A single substitution in a 21 to 25mer moves the melting temperature by a
   * median of roughly 1.7 degrees and never more than about 3.5, and the effect
   * shrinks as the probe lengthens. Thresholds are set from that measured range
   * rather than from a textbook figure for a mismatch in a longer oligo.
   */
  class: 'usable' | 'marginal' | 'inert' | 'broken';
}

export interface SignalAnalysis {
  /** Excitation photons striking the sample per second. */
  excitationPhotonsPerSecond: number;
  /** Photoelectrons collected per integration window. */
  signalCounts: number;
  /** Photoelectrons contributed by the detector dark current. */
  darkCounts: number;
  /** ADC quantum-noise-limited SNR. */
  adcSnr: number;
  /** Shot-noise and dark-current-limited SNR. */
  shotSnr: number;
  snr: number;
  /**
   * Fold separation between the mutant and wild-type hybrid populations implied
   * by the probe free-energy difference. Reported as evidence; whether it is
   * large enough is the thermo factor's question, not the detector's.
   */
  discriminationMargin: number;
  class: 'resolves' | 'marginal' | 'unresolved';
}

export interface FlightAnalysis {
  /** Unshielded dose rate behind the spacecraft walls, rad(Si)/day. */
  baseDoseRateRadDay: number;
  /** Spacecraft-shielded GCR dose rate, rad(Si)/day. */
  gcrDoseRateRadDay: number;
  /** Spacecraft-shielded SPE dose rate during the current event, rad(Si)/day. */
  speDoseRateRadDay: number;
  shielding: number;
  totalDoseKrad: number;
  /** Expected single-event upsets over the mission in the sample buffer. */
  expectedUpsets: number;
  /** Probability that at least one readout is corrupted, given voting. */
  corruptionProbability: number;
  requiredVoting: number;
  class: 'cleared' | 'marginal' | 'fails';
}

export interface StructuralAnalysis {
  enclosing: AnnotatedSite | null;
  offsetInSite: number | null;
  /** 0..1, 1 = position is in a structurally unconstrained region. */
  support: number;
  notes: string[];
}

export interface Factor {
  key: string;
  label: string;
  weight: number;
  /** 0..1 where 1 supports flight readiness. */
  support: number;
  /** weight * support, rounded to 4dp for display. */
  contribution: number;
  summary: string;
  evidence: Array<{ label: string; value: string }>;
}

export interface Gate {
  id: string;
  passed: boolean;
  detail: string;
}

export type Verdict =
  | 'FLIGHT-GO'
  | 'GROUND-ONLY'
  | 'REDESIGN-PROBE'
  | 'HOLD-FOR-EVIDENCE';

export interface EngineInput {
  profile: GeneProfile;
  proteinPosition: number;
  refAa: string;
  altAa: string;
  /**
   * Which base of the codon changes, 0 to 2. The mutation scrub sets this
   * explicitly so the scored nucleotide change is the one on screen and the HGVS
   * notation matches. When it is omitted the engine prices every single-nucleotide
   * substitution that reaches `altAa` and returns the one that best preserves the
   * probe, which is the "just tell me the cheapest option" flow.
   */
  baseOffset?: number;
  instrument: InstrumentProfile;
  flight: FlightProfile;
  probe: ProbeDesign;
  spaceWeather: SpaceWeather;
}

export interface EngineResult {
  engine: 'orbitgene/1.0.0';
  score: number;
  verdict: Verdict;
  gates: Gate[];
  factors: Factor[];
  codon: CodonAnalysis;
  thermo: ThermoAnalysis;
  signal: SignalAnalysis;
  flight: FlightAnalysis;
  structural: StructuralAnalysis;
  /** sha256 over the canonical JSON of every input that feeds the engine. */
  inputDigest: string;
}

/**
 * What a sealed record stores: the engine result exactly as it was produced,
 * plus the clinical context that was true at scoring time.
 *
 * Clinical context is stored rather than re-fetched on read so that replaying a
 * record from last month shows what was known when it was scored, not what is
 * known now.
 */
export interface SealedResult extends EngineResult {
  clinical?: ClinicalContext;
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

export type AssayStatus = 'scored' | 'probe-ordered' | 'in-flight' | 'retired';

export interface AssayDecision {
  verdict: Verdict;
  rationale: string;
  decidedAt: string;
}

export interface AssayRecord {
  id: string;
  well: string;
  ownerId: string;
  geneSymbol: string;
  uniprotAccession: string;
  refseqMrna: string;
  proteinPosition: number;
  refAa: string;
  altAa: string;
  hgvsP: string;
  hgvsC: string;
  consequence: Consequence;
  probeSequence: string;
  instrumentId: string;
  flightProfileId: string;
  notes: string;
  status: AssayStatus;
  score: number;
  verdict: Verdict;
  decision: AssayDecision | null;
  result: EngineResult;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Terminal seal of this record's audit chain. */
  seal: string;
}

export type AuditAction =
  | 'created'
  | 'updated'
  | 'decided'
  | 'deleted'
  | 'restored';

export interface AuditEvent {
  seq: number;
  entityId: string;
  action: AuditAction;
  at: string;
  actor: 'session' | 'agent';
  detail: Record<string, unknown>;
  prevSeal: string;
  seal: string;
}

export interface ReplayReport {
  entityId: string;
  /** True when this session owns the record, so ids cannot be probed. */
  owned: boolean;
  ok: boolean;
  length: number;
  genesis: string;
  head: string | null;
  /** First event whose recomputed seal does not match, if any. */
  brokenAt: number | null;
  brokenReason: string | null;
  events: AuditEvent[];
}

export interface ShareLink {
  token: string;
  assayId: string;
  /** Owner the link was minted for. Internal: never serialised to the browser. */
  ownerId: string;
  createdAt: string;
}

export interface SessionSettings {
  instrument: InstrumentProfile;
  flight: FlightProfile;
  probe: ProbeDesign;
}

/* ------------------------------------------------------------------ */
/* API envelopes                                                       */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, string>;
  };
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  store: 'neon-postgres' | 'pglite-embedded' | 'unavailable';
  durable: boolean;
  latencyMs: number;
  migration: string;
  counts: Record<string, number>;
  checkedAt: string;
}