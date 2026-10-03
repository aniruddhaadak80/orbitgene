import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted recursively, arrays order-preserving,
 * `undefined` members dropped, and no incidental whitespace. Two structurally
 * equal values always serialise to the same bytes, which is what makes the
 * SHA-384 seal chain in `integrity.ts` reproducible from outside this process.
 */
export function canonicalJson(value: unknown): string {
  return serialise(value);
}

function serialise(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) return 'null';
    return JSON.stringify(value);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify((value as bigint).toString());
  if (t === 'undefined' || t === 'function' || t === 'symbol') return 'null';

  if (Array.isArray(value)) {
    return `[${value.map((v) => (v === undefined ? 'null' : serialise(v))).join(',')}]`;
  }

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${serialise(obj[k])}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Short, human-quotable digest for compact display in tables. */
export function shortDigest(hex: string, length = 12): string {
  return hex.slice(0, length);
}