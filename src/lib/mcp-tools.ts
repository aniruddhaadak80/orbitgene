import { z } from 'zod';
import { findFlight, findInstrument, INSTRUMENT_PRESETS, FLIGHT_PRESETS } from './profiles';
import { ENGINE_VERSION } from './engine';

/**
 * MCP tool catalogue.
 *
 * Every tool is a thin, typed wrapper over the same service layer the browser
 * calls, so an agent and a human cannot end up with different answers. The
 * schemas are published verbatim in `tools/list` and are what `public/mcp.json`
 * points at.
 */

const AA = z
  .string()
  .trim()
  .regex(/^[ACDEFGHIKLMNPQRSTVWY*]$/, 'must be a one-letter amino-acid code or *');

export const TOOLS = [
  {
    name: 'list_presets',
    description:
      'List the assay instrument boards and flight profiles that scores can be run against. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    handler: async () => ({
      instruments: INSTRUMENT_PRESETS,
      flights: FLIGHT_PRESETS,
      engine: ENGINE_VERSION,
    }),
  },
  {
    name: 'get_space_weather',
    description:
      'Current NOAA space weather: planetary K index, GOES X-ray class and integral proton flux, each labelled live or fallback.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    readOnly: true,
    handler: async (_args: unknown, ctx: { spaceWeather: () => Promise<unknown> }) => ctx.spaceWeather(),
  },
  {
    name: 'score_mutation',
    description:
      'Score a real protein substitution against an assay configuration and the live radiation environment. Returns a versioned score, six itemised factors, five gates and a verdict. Persists nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string', description: 'UniProt accession, for example P38398' },
        proteinPosition: { type: 'integer', minimum: 1 },
        refAa: { type: 'string', description: 'Wild-type one-letter residue' },
        altAa: { type: 'string', description: 'Alternate one-letter residue' },
        baseOffset: {
          type: 'integer',
          minimum: 0,
          maximum: 2,
          description: 'Which base of the codon changes. Omit to let the engine price every option.',
        },
        instrumentId: { type: 'string' },
        flightProfileId: { type: 'string' },
      },
      required: ['accession', 'proteinPosition', 'refAa', 'altAa'],
      additionalProperties: false,
    },
    readOnly: true,
    schema: z.object({
      accession: z.string().trim().regex(/^[A-Z0-9]{6,10}$/),
      proteinPosition: z.number().int().min(1).max(100000),
      refAa: AA,
      altAa: AA,
      baseOffset: z.number().int().min(0).max(2).optional(),
      instrumentId: z.string().trim().max(64).optional(),
      flightProfileId: z.string().trim().max(64).optional(),
    }),
    handler: async (args: unknown, ctx: { score: (a: Record<string, unknown>) => Promise<unknown> }) => {
      const parsed = z
        .object({
          accession: z.string(),
          proteinPosition: z.number(),
          refAa: z.string(),
          altAa: z.string(),
          baseOffset: z.number().optional(),
          instrumentId: z.string().optional(),
          flightProfileId: z.string().optional(),
        })
        .parse(args);

      const response = (await ctx.score(parsed)) as {
        ok: boolean;
        result?: unknown;
        reason?: string;
      };
      if (!response.ok) {
        const error = new Error(response.reason ?? 'the substitution could not be scored');
        (error as Error & { code?: string }).code = 'not-scorable';
        throw error;
      }
      return response.result;
    },
  },
  {
    name: 'list_assays',
    description: 'List this session\'s plate records, newest first. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['scored', 'probe-ordered', 'in-flight', 'retired'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    readOnly: true,
    schema: z.object({
      status: z.enum(['scored', 'probe-ordered', 'in-flight', 'retired']).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    }),
    handler: async (args: unknown, ctx: { list: (a: Record<string, unknown>) => Promise<unknown> }) =>
      ctx.list((args ?? {}) as Record<string, unknown>),
  },
  {
    name: 'get_assay',
    description: 'Read one plate record together with its full audit chain.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    readOnly: true,
    schema: z.object({ id: z.string().uuid() }),
    handler: async (args: unknown, ctx: { get: (id: string) => Promise<unknown> }) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(args);
      return ctx.get(id);
    },
  },
  {
    name: 'create_assay',
    description:
      'Create a plate record from a real substitution and append the first sealed audit event. Supports idempotency: repeating a call with the same idempotencyKey returns the original record instead of creating a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        accession: { type: 'string' },
        proteinPosition: { type: 'integer', minimum: 1 },
        refAa: { type: 'string' },
        altAa: { type: 'string' },
        baseOffset: { type: 'integer', minimum: 0, maximum: 2 },
        well: { type: 'string', description: '96-well plate coordinate such as B7' },
        instrumentId: { type: 'string' },
        flightProfileId: { type: 'string' },
        notes: { type: 'string', maxLength: 500 },
        idempotencyKey: { type: 'string', description: 'Replay-safe key for retries' },
      },
      required: ['accession', 'proteinPosition', 'refAa', 'altAa', 'well'],
      additionalProperties: false,
    },
    readOnly: false,
    schema: z.object({
      accession: z.string().trim().regex(/^[A-Z0-9]{6,10}$/),
      proteinPosition: z.number().int().min(1).max(100000),
      refAa: AA,
      altAa: AA,
      baseOffset: z.number().int().min(0).max(2).optional(),
      well: z.string().trim().regex(/^[A-H](?:[1-9]|1[0-2])$/),
      instrumentId: z.string().trim().max(64).optional(),
      flightProfileId: z.string().trim().max(64).optional(),
      notes: z.string().trim().max(500).optional(),
      idempotencyKey: z.string().trim().min(8).max(128).optional(),
    }),
    handler: async (args: unknown, ctx: { create: (a: Record<string, unknown>) => Promise<unknown> }) =>
      ctx.create(args as Record<string, unknown>),
  },
  {
    name: 'record_decision',
    description:
      'Seal a verdict against a plate record with a written rationale. Idempotent on idempotencyKey; appends to the same hash chain.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        verdict: {
          type: 'string',
          enum: ['FLIGHT-GO', 'GROUND-ONLY', 'REDESIGN-PROBE', 'HOLD-FOR-EVIDENCE'],
        },
        rationale: { type: 'string', minLength: 3, maxLength: 600 },
        idempotencyKey: { type: 'string' },
      },
      required: ['id', 'verdict', 'rationale'],
      additionalProperties: false,
    },
    readOnly: false,
    schema: z.object({
      id: z.string().uuid(),
      verdict: z.enum(['FLIGHT-GO', 'GROUND-ONLY', 'REDESIGN-PROBE', 'HOLD-FOR-EVIDENCE']),
      rationale: z.string().trim().min(3).max(600),
      idempotencyKey: z.string().trim().min(8).max(128).optional(),
    }),
    handler: async (args: unknown, ctx: { decide: (a: Record<string, unknown>) => Promise<unknown> }) =>
      ctx.decide(args as Record<string, unknown>),
  },
  {
    name: 'retire_assay',
    description:
      'Retire a plate record. Requires the record\'s current terminal seal as confirmation, so an agent cannot delete a record it has not inspected. The row is retained as a tombstone and its chain still replays.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        seal: { type: 'string', description: '96-character SHA-384 terminal seal' },
      },
      required: ['id', 'seal'],
      additionalProperties: false,
    },
    readOnly: false,
    schema: z.object({
      id: z.string().uuid(),
      seal: z.string().trim().regex(/^[0-9a-f]{96}$/),
    }),
    handler: async (args: unknown, ctx: { retire: (a: Record<string, unknown>) => Promise<unknown> }) =>
      ctx.retire(args as Record<string, unknown>),
  },
  {
    name: 'verify_integrity',
    description:
      'Recompute a record\'s SHA-384 hash chain from its genesis value and report the first broken link, if any.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid' } },
      required: ['id'],
      additionalProperties: false,
    },
    readOnly: true,
    schema: z.object({ id: z.string().uuid() }),
    handler: async (args: unknown, ctx: { verify: (id: string) => Promise<unknown> }) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(args);
      return ctx.verify(id);
    },
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];

/** JSON-RPC error codes used by this endpoint. */
export const RPC = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export function isTool(name: string): boolean {
  return TOOLS.some((t) => t.name === name);
}

export function toolNames(): string[] {
  return TOOLS.map((t) => t.name);
}

export function publicTools() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.readOnly },
  }));
}

export function toolByName(name: string) {
  return TOOLS.find((t) => t.name === name);
}

export { findFlight, findInstrument };