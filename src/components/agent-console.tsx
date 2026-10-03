'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Play, RotateCcw } from 'lucide-react';
import { Panel, PanelHeading } from './ui';

interface RpcEnvelope {
  jsonrpc?: string;
  id?: unknown;
  result?: {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string; data?: unknown };
}

interface PresetCall {
  label: string;
  tool: string;
  args?: Record<string, unknown>;
  note: string;
}

/**
 * Agent console.
 *
 * These buttons issue real JSON-RPC requests to the live MCP endpoint. The
 * mutating calls go through exactly the same service layer as the buttons on the
 * record page, and the panel says so when a call comes back.
 */
export function AgentConsole() {
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<
    Array<{ label: string; request: unknown; response: RpcEnvelope | null; error?: string; ms: number }>
  >([]);
  const [lastRecord, setLastRecord] = useState<string | null>(null);

  const call = useCallback(async (label: string, method: string, params?: unknown) => {
    setBusy(label);
    const started = Date.now();
    const request = { jsonrpc: '2.0', id: Date.now(), method, ...(params ? { params } : {}) };
    try {
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      });
      const body = (await response.json()) as RpcEnvelope;
      setLog((entries) => [...entries, { label, request, response: body, ms: Date.now() - started }]);

      if (method === 'tools/call') {
        const text = JSON.stringify(body.result?.structuredContent ?? '');
        const match = /"id"\s*:\s*"([0-9a-f-]{36})"/.exec(text);
        if (match) setLastRecord(match[1]);
      }
    } catch (e) {
      setLog((entries) => [
        ...entries,
        {
          label,
          request,
          response: null,
          error: e instanceof Error ? e.message : 'request failed',
          ms: Date.now() - started,
        },
      ]);
    } finally {
      setBusy(null);
    }
  }, []);

  const presets: PresetCall[] = [
    {
      label: 'initialize',
      tool: 'initialize',
      note: 'Protocol handshake. Returns the server version and capabilities.',
    },
    {
      label: 'list_assays',
      tool: 'list_assays',
      args: { limit: 10 },
      note: 'Read tool. Lists this session plate.',
    },
    {
      label: 'score_mutation',
      tool: 'score_mutation',
      args: {
        accession: 'P01308',
        proteinPosition: 2,
        altAa: 'V',
      },
      note: 'Analysis tool. Runs the engine, persists nothing.',
    },
  ];

  return (
    <div className="mx-auto max-w-[1240px] space-y-5 px-4 py-10 sm:px-6">
      <header>
        <p className="label">Agent console</p>
        <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">Drive it over MCP</h1>
        <p className="mt-2 max-w-prose text-[0.85rem] leading-relaxed text-ink-dim">
          A live JSON-RPC 2.0 endpoint with nine typed tools. Every mutating tool calls the same
          service layer the interface calls, scoped to this anonymous session, so an agent cannot
          reach a plate it does not own.
        </p>
      </header>

      <Panel>
        <PanelHeading
          title="One-click calls"
          detail="These issue real requests against /api/mcp. Nothing here is simulated."
        />
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void call(
                  preset.label,
                  preset.tool === 'initialize' ? 'initialize' : 'tools/call',
                  preset.tool === 'initialize' ? undefined : { name: preset.tool, arguments: preset.args ?? {} },
                )
              }
              className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim transition-colors hover:border-signal/60 hover:text-signal disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {preset.label}
            </button>
          ))}

          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void call('tools/list', 'tools/list')
            }
            className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim hover:border-signal/60 hover:text-signal disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            tools/list
          </button>

          <button
            type="button"
            disabled={busy !== null || !lastRecord}
            onClick={() =>
              void call('verify_integrity', 'tools/call', {
                name: 'verify_integrity',
                arguments: { id: lastRecord },
              })
            }
            className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.78rem] text-ink-dim hover:border-signal/60 hover:text-signal disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            verify_integrity
          </button>
        </div>

        <ul className="mt-4 grid gap-1.5">
          {presets.map((preset) => (
            <li key={preset.label} className="text-[0.72rem] leading-relaxed text-ink-faint">
              <span className="data text-ink-dim">{preset.tool}</span> &mdash; {preset.note}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <PanelHeading
          title="Mutate through the agent"
          detail="Creates a record through the same service layer as the UI, with an idempotency key so a retry does not duplicate it."
          action={
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void call('create_assay', 'tools/call', {
                  name: 'create_assay',
                  arguments: {
                    accession: 'P01308',
                    proteinPosition: 4,
                    altAa: '*',
                    well: 'C3',
                    notes: 'Created from the agent console',
                    idempotencyKey: `agent-demo-${Date.now()}`,
                  },
                })
              }
              className="inline-flex items-center gap-2 rounded-md bg-signal px-3 py-2 text-[0.78rem] font-semibold text-substrate hover:opacity-90 disabled:opacity-50"
            >
              create_assay
            </button>
          }
        />
        <p className="text-[0.76rem] leading-relaxed text-ink-dim">
          Insulin tryptophan 4 to a stop codon, written into well C3. The record appears on the plate
          immediately, which is the proof that the agent and the interface share one code path.
        </p>
        {lastRecord ? (
          <Link href={`/assay/${lastRecord}`} className="mt-3 inline-block text-[0.78rem] text-signal hover:underline">
            Open the record the agent just wrote
          </Link>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeading
          title="Call log"
          detail="Request and response for every call, exactly as they went over the wire."
          action={
            <button
              type="button"
              onClick={() => setLog([])}
              className="inline-flex items-center gap-2 rounded-md border border-rim px-3 py-2 text-[0.74rem] text-ink-dim hover:border-signal/60 hover:text-signal"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Clear
            </button>
          }
        />

        {log.length === 0 ? (
          <p className="text-[0.78rem] text-ink-faint">No calls yet. Press one above.</p>
        ) : (
          <ul className="grid gap-3">
            {log.map((entry, index) => (
              <li key={index} className="rounded-lg border border-rim">
                <div className="flex flex-wrap items-baseline gap-2 border-b border-rim/70 px-3 py-2">
                  <span className="label text-[0.6rem]">{entry.label}</span>
                  <span className="data text-[0.64rem] text-ink-faint">{entry.ms} ms</span>
                  {entry.error ? (
                    <span className="label text-[0.56rem]" style={{ color: 'var(--color-refused)' }}>
                      failed
                    </span>
                  ) : entry.response?.result?.isError ? (
                    <span className="label text-[0.56rem]" style={{ color: 'var(--color-caution)' }}>
                      tool error
                    </span>
                  ) : (
                    <span className="label text-[0.56rem]" style={{ color: 'var(--color-cleared)' }}>
                      ok
                    </span>
                  )}
                </div>
                <div className="grid gap-2 p-3 md:grid-cols-2">
                  <div>
                    <p className="label text-[0.56rem]">Request</p>
                    <pre className="data mt-1 overflow-x-auto rounded-md border border-rim bg-[#0a0e13] p-2.5 text-[0.66rem] leading-relaxed text-ink-dim">
                      {JSON.stringify(entry.request, null, 2)}
                    </pre>
                  </div>
                  <div>
                    <p className="label text-[0.56rem]">Response</p>
                    <pre className="data mt-1 max-h-72 overflow-auto rounded-md border border-rim bg-[#0a0e13] p-2.5 text-[0.66rem] leading-relaxed text-ink-dim">
                      {entry.error ?? JSON.stringify(entry.response, null, 2)}
                    </pre>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHeading title="Wire this into an agent" />
        <div className="grid gap-3 text-[0.76rem] text-ink-dim">
          <p>
            The endpoint speaks MCP over HTTP POST with JSON-RPC 2.0 and implements{' '}
            <span className="data text-ink">initialize</span>, <span className="data text-ink">tools/list</span>{' '}
            and <span className="data text-ink">tools/call</span>. A published manifest sits at{' '}
            <span className="data text-signal">/mcp.json</span>.
          </p>
          <pre className="data overflow-x-auto rounded-md border border-rim bg-[#0a0e13] p-3 text-[0.68rem] leading-relaxed">
{`curl -s $BASE/api/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
          </pre>
          <p>
            Nine tools: three read, four mutating, two verification. Deletion requires the record
           &apos;s own terminal seal, so an agent cannot remove something it has not inspected.
          </p>
        </div>
      </Panel>
    </div>
  );
}