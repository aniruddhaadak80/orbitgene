import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { readSettings } from '@/lib/session';
import { loadSpaceWeather } from '@/lib/sources/spaceweather';
import { substitutionDial } from '@/lib/genetics';
import {
  createAssayRecord,
  decide as decideRecord,
  fetchReplay,
  listAssaysWith,
  retire,
  score,
} from '@/lib/services/assays';
import { getAssay, listAudit } from '@/lib/repo/assays';
import { publicTools, RPC, toolByName } from '@/lib/mcp-tools';
import { describe } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * MCP-style JSON-RPC 2.0 endpoint.
 *
 * Implements `initialize`, `tools/list` and `tools/call` with structured schemas
 * and proper JSON-RPC error objects. Every mutating tool calls the same service
 * functions the browser calls, scoped to the caller's anonymous session, so an
 * agent cannot reach another session's plate and cannot skip the seal
 * confirmation required before a destructive call.
 */

const PROTOCOL_VERSION = '2025-06-18';

type RpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
};

type HandlerContext = {
  ownerId: string;
  settings: Awaited<ReturnType<typeof readSettings>>;
  db: Awaited<ReturnType<typeof getDb>>;
};

function rpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id: id ?? null, result };
}

export async function POST(request: Request): Promise<NextResponse> {
  const { ownerId } = await import('@/lib/session').then((m) => m.resolveOwner(request));
  const owner = await ownerId;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(rpcError(null, RPC.PARSE_ERROR, 'The request body was not valid JSON.'), {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const headers = { 'cache-control': 'no-store' };

  // Batches are part of the JSON-RPC specification.
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return NextResponse.json(
        rpcError(null, RPC.INVALID_REQUEST, 'A batch must contain at least one request.'),
        { status: 200, headers },
      );
    }
    const results = [];
    for (const entry of payload) {
      results.push(await dispatch(entry as RpcRequest, owner));
    }
    return NextResponse.json(results, { status: 200, headers });
  }

  return NextResponse.json(await dispatch(payload as RpcRequest, owner), { status: 200, headers });
}

async function dispatch(request: RpcRequest, ownerId: string): Promise<unknown> {
  const id = request?.id ?? null;

  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    return rpcError(id, RPC.INVALID_REQUEST, 'Expected a JSON-RPC 2.0 request object.');
  }

  switch (request.method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'orbitgene', version: '1.0.0' },
        instructions:
          "ORBITGENE scores real protein substitutions for DNA assay hardware. Start with list_presets, then score_mutation for an explainable result, then create_assay to persist it. Use verify_integrity to confirm the audit chain, and retire_assay only after reading the record's seal.",
      });

    case 'notifications/initialized':
    case 'ping':
      return rpcResult(id, {});

    case 'tools/list':
      return rpcResult(id, { tools: publicTools() });

    case 'tools/call':
      return callTool(id, request.params, ownerId);

    default:
      return rpcError(id, RPC.METHOD_NOT_FOUND, `Unknown method "${request.method}".`);
  }
}

async function callTool(
  id: string | number | null,
  params: unknown,
  ownerId: string,
): Promise<unknown> {
  const parsed = z
    .object({ name: z.string().trim().min(1), arguments: z.unknown().optional() })
    .safeParse(params);

  if (!parsed.success) {
    return rpcError(id, RPC.INVALID_PARAMS, 'tools/call requires a name and optional arguments.');
  }

  const tool = toolByName(parsed.data.name);
  if (!tool) {
    return rpcError(id, RPC.METHOD_NOT_FOUND, `Unknown tool "${parsed.data.name}".`);
  }

  const schema = (tool as { schema?: z.ZodType }).schema;
  let args: Record<string, unknown> = (parsed.data.arguments ?? {}) as Record<string, unknown>;

  if (schema) {
    const validated = schema.safeParse(args);
    if (!validated.success) {
      return rpcError(id, RPC.INVALID_PARAMS, 'The tool arguments did not match its schema.', {
        issues: validated.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    args = validated.data as Record<string, unknown>;
  }

  try {
    const ctx = await buildContext(ownerId);
    const output = await (tool as { handler: (a: unknown, c: unknown) => Promise<unknown> }).handler(
      args,
      ctx,
    );

    // A tool that fails is reported in the result body with `isError`, not as a
    // protocol error, so a model can read and react to the message.
    return rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
      isError: false,
    });
  } catch (error) {
    const described = describe(error);
    const message =
      described && 'error' in described
        ? String((described as { error: { message: string } }).error.message)
        : 'The tool call failed.';
    return rpcResult(id, {
      content: [{ type: 'text', text: message }],
      isError: true,
    });
  }
}

/** Service wiring the tool handlers share. Identical to the REST routes' layer. */
async function buildContext(ownerId: string): Promise<HandlerContext> {
  const db = await getDb();
  const settings = await readSettings(ownerId);

  const ctx = {
    ownerId,
    settings,
    db,

    spaceWeather: () => loadSpaceWeather(),

    score: async (a: Record<string, unknown>) => {
      const { outcome, profile } = await score({
        accession: String(a.accession),
        proteinPosition: Number(a.proteinPosition),
        refAa: String(a.refAa),
        altAa: String(a.altAa),
        baseOffset: typeof a.baseOffset === 'number' ? a.baseOffset : undefined,
        instrumentId: String(a.instrumentId ?? settings.instrument.id),
        flightProfileId: String(a.flightProfileId ?? settings.flight.id),
      });
      if (!outcome.ok) {
        throw Object.assign(new Error(outcome.reason), { code: 'not-scorable' });
      }
      return {
        ...outcome.result,
        dial: substitutionDial(profile.gene.cds, Number(a.proteinPosition)),
        gene: profile.gene,
      };
    },

    list: (a: Record<string, unknown>) =>
      listAssaysWith(db, ownerId, {
        status: a.status as never,
        limit: typeof a.limit === 'number' ? a.limit : 50,
        offset: typeof a.offset === 'number' ? a.offset : 0,
      }),

    get: async (assayId: string) => {
      const assay = await getAssay(db, ownerId, assayId);
      if (!assay) throw new Error('No assay with that id exists in this session.');
      return { assay, events: await listAudit(db, assayId) };
    },

    create: async (a: Record<string, unknown>) => {
      const result = await createAssayRecord(
        db,
        ownerId,
        {
          accession: String(a.accession),
          proteinPosition: Number(a.proteinPosition),
          refAa: String(a.refAa),
          altAa: String(a.altAa),
          baseOffset: typeof a.baseOffset === 'number' ? a.baseOffset : undefined,
          well: String(a.well),
          instrumentId: String(a.instrumentId ?? settings.instrument.id),
          flightProfileId: String(a.flightProfileId ?? settings.flight.id),
          notes: String(a.notes ?? ''),
          idempotencyKey: typeof a.idempotencyKey === 'string' ? a.idempotencyKey : undefined,
        },
        new Date().toISOString(),
        settings,
      );
      if (result.status === 'error') throw new Error(result.message);
      return { assay: result.assay, replayed: result.status === 'replayed', actor: 'agent' };
    },

    decide: async (a: Record<string, unknown>) => {
      const result = await decideRecord(
        db,
        ownerId,
        String(a.id),
        a.verdict as never,
        String(a.rationale),
        new Date().toISOString(),
        'agent',
      );
      if (result.status === 'error') throw new Error(result.message);
      return { assay: result.assay, seal: result.assay.seal, actor: 'agent' };
    },

    retire: async (a: Record<string, unknown>) => {
      const result = await retire(
        db,
        ownerId,
        String(a.id),
        String(a.seal),
        new Date().toISOString(),
        'agent',
      );
      if (result.status === 'error') throw new Error(result.message);
      return { retired: result.assay.id, tombstone: true, seal: result.assay.seal, actor: 'agent' };
    },

    verify: async (assayId: string) => {
      const { report, assay } = await fetchReplay(db, ownerId, assayId);
      if (!report.owned) throw new Error('No assay with that id exists in this session.');
      return {
        report,
        tombstone: assay?.deletedAt ? { deletedAt: assay.deletedAt } : null,
      };
    },
  };

  return ctx as unknown as HandlerContext;
}

/** GET advertises the surface so a browser visit is not a bare 405. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      protocol: 'mcp',
      protocolVersion: PROTOCOL_VERSION,
      endpoint: '/api/mcp',
      transport: 'HTTP POST with JSON-RPC 2.0',
      methods: ['initialize', 'tools/list', 'tools/call', 'ping'],
      tools: publicTools().map((t) => ({ name: t.name, readOnly: t.annotations.readOnlyHint })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}