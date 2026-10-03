import { z } from 'zod';

/**
 * Request validation. Every API route parses its input through these schemas so
 * the database, the engine and the audit chain only ever see constrained values.
 */

export const AA = z
  .string()
  .trim()
  .regex(/^[ACDEFGHIKLMNPQRSTVWY*]$/, 'must be a one-letter amino-acid code');

export const ACCESSION = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{6,10}$/, 'must look like a UniProt accession, for example P38398');

export const IDEMPOTENCY_KEY = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, 'must be URL-safe ASCII');

export const createAssaySchema = z.object({
  accession: ACCESSION,
  proteinPosition: z.number().int().min(1).max(100000),
  refAa: AA,
  altAa: AA,
  baseOffset: z.number().int().min(0).max(2).optional(),
  well: z
    .string()
    .trim()
    .regex(/^[A-H](?:[1-9]|1[0-2])$/, 'must be a 96-well plate coordinate such as B7'),
  /** Optional: the session configuration from /settings supplies the default. */
  instrumentId: z.string().trim().min(1).max(64).optional(),
  /** Optional: the session configuration from /settings supplies the default. */
  flightProfileId: z.string().trim().min(1).max(64).optional(),
  notes: z.string().trim().max(500).default(''),
  idempotencyKey: IDEMPOTENCY_KEY.optional(),
});

export const updateAssaySchema = z
  .object({
    well: z
      .string()
      .trim()
      .regex(/^[A-H](?:[1-9]|1[0-2])$/, 'must be a 96-well plate coordinate such as B7')
      .optional(),
    status: z.enum(['scored', 'probe-ordered', 'in-flight', 'retired']).optional(),
    notes: z.string().trim().max(500).optional(),
    instrumentId: z.string().trim().min(1).max(64).optional(),
    flightProfileId: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'at least one field must be provided');

export const decisionSchema = z.object({
  verdict: z.enum(['FLIGHT-GO', 'GROUND-ONLY', 'REDESIGN-PROBE', 'HOLD-FOR-EVIDENCE']),
  rationale: z.string().trim().min(3).max(600),
  idempotencyKey: IDEMPOTENCY_KEY.optional(),
});

/** Destructive operations must echo the terminal seal they intend to remove. */
export const deleteAssaySchema = z.object({
  seal: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{96}$/, 'must be the 96-character SHA-384 seal of the record'),
  confirm: z.literal(true),
});

export const scoreRequestSchema = z.object({
  accession: ACCESSION,
  proteinPosition: z.number().int().min(1).max(100000),
  /** Optional: the service reads the residue from the retrieved coding sequence. */
  refAa: AA.optional(),
  altAa: AA,
  instrumentId: z.string().trim().min(1).max(64).default('esp32-405-npi'),
  flightProfileId: z.string().trim().min(1).max(64).default('cubesat-leo'),
});

export const listQuerySchema = z.object({
  status: z.enum(['scored', 'probe-ordered', 'in-flight', 'retired']).optional(),
  gene: z.string().trim().max(32).optional(),
  q: z.string().trim().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const settingsSchema = z.object({
  instrument: z.object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(160),
    emitterNm: z.number().min(200).max(1200),
    emitterMw: z.number().min(0).max(500),
    detectorResponsivityAw: z.number().min(0).max(100),
    darkCurrentPa: z.number().min(0).max(1e6),
    gain: z.number().min(1).max(1e12),
    adcBits: z.number().int().min(8).max(24),
    adcFullScaleV: z.number().min(0.1).max(10),
    integrationMs: z.number().min(0.1).max(60000),
    quantumYield: z.number().min(0).max(1),
    volumeUl: z.number().min(0.1).max(5000),
    probeLengthNt: z.number().int().min(15).max(40),
  }),
  flight: z.object({
    id: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(160),
    altitudeKm: z.number().min(120).max(40000),
    inclinationDeg: z.number().min(0).max(180),
    missionDays: z.number().min(1).max(3650),
    shieldingMgPerCm2: z.number().min(1).max(20000),
    sramBitsMb: z.number().min(0.001).max(4096),
    readoutVoting: z.number().int().min(1).max(32),
  }),
  probe: z.object({
    sequence: z.string().trim().max(60).default(''),
    sodiumMolar: z.number().min(1e-4).max(5),
    strandConcentrationNm: z.number().min(1e-3).max(1e6),
  }),
});

export const shareSchema = z.object({
  assayId: z.string().trim().regex(/^[0-9a-f-]{36}$/, 'must be a UUID'),
});

export const triageSchema = z.object({
  note: z.string().trim().min(3).max(600),
  limit: z.number().int().min(1).max(20).default(6),
});

export type CreateAssayInput = z.infer<typeof createAssaySchema>;
export type UpdateAssayInput = z.infer<typeof updateAssaySchema>;
export type ScoreRequest = z.infer<typeof scoreRequestSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;