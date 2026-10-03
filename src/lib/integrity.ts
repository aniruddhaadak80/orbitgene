import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical';
import type { AuditEvent, ReplayReport } from './types';

/**
 * Append-only, per-entity hash chain.
 *
 *   seal_0 = GENESIS
 *   seal_n = SHA-384( UTF-8(seal_{n-1}) || canonicalJson(event_n) )
 *
 * `event_n` excludes its own `seal` and `prevSeal` fields from the digest, so
 * recomputation is independent of storage order. Verification walks the chain
 * from the genesis value and reports the first event whose recomputed seal does
 * not match the stored one.
 */
export const GENESIS = 'orbitgene/genesis/v1';

export function computeSeal(prevSeal: string, event: SealableEvent): string {
  const payload = canonicalJson(normalise(event));
  return createHash('sha384')
    .update(prevSeal, 'utf8')
    .update(payload, 'utf8')
    .digest('hex');
}

type SealableEvent = Omit<AuditEvent, 'seal' | 'prevSeal'>;

function normalise(event: SealableEvent): Record<string, unknown> {
  return {
    seq: event.seq,
    entityId: event.entityId,
    action: event.action,
    at: event.at,
    actor: event.actor,
    detail: event.detail,
  };
}

/** Builds the next sealed event given the current head. */
export function sealNext(
  prevSeal: string,
  event: SealableEvent,
): { prevSeal: string; seal: string } {
  return { prevSeal, seal: computeSeal(prevSeal, event) };
}

/**
 * Recomputes a whole chain. `events` may arrive in any order; they are sorted
 * by `seq` first. Returns the first broken link rather than throwing, so the
 * UI can show exactly where integrity fails.
 */
export function replay(entityId: string, events: AuditEvent[]): ReplayReport {
  const ordered = [...events]
    .filter((e) => e.entityId === entityId)
    .sort((a, b) => a.seq - b.seq);

  let prev = GENESIS;
  let brokenAt: number | null = null;
  let brokenReason: string | null = null;

  for (const event of ordered) {
    if (event.prevSeal !== prev) {
      brokenAt = event.seq;
      brokenReason = `event ${event.seq} declares prevSeal ${event.prevSeal.slice(0, 16)}… but the chain head was ${prev.slice(0, 16)}…`;
      break;
    }
    const expected = computeSeal(prev, event);
    if (expected !== event.seal) {
      brokenAt = event.seq;
      brokenReason = `event ${event.seq} seal is ${event.seal.slice(0, 16)}… but recomputes to ${expected.slice(0, 16)}…`;
      break;
    }
    prev = expected;
  }

  const ok = brokenAt === null && ordered.length > 0;
  return {
    entityId,
    owned: true,
    ok,
    length: ordered.length,
    genesis: GENESIS,
    head: prev,
    brokenAt,
    brokenReason,
    events: ordered,
  };
}