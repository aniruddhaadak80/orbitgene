
/**
 * Time-bounded HTTP helpers for upstream data sources.
 *
 * Every outbound request is capped, retried a bounded number of times and tagged
 * with the upstream URL it came from, so a slow or failing third party degrades
 * into a labelled fallback instead of a hung server render.
 */

export const UPSTREAM_TIMEOUT_MS = 12_000;
export const UPSTREAM_RETRIES = 2;

/** Only these hosts are ever contacted. */
const ALLOWED_HOSTS = new Set([
  'rest.uniprot.org',
  'eutils.ncbi.nlm.nih.gov',
  'services.swpc.noaa.gov',
  'api.genome.ucsc.edu',
]);

export class UpstreamError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  constructor(message: string, url: string, status?: number) {
    super(message);
    this.name = 'UpstreamError';
    this.url = url;
    this.status = status;
  }
}

function assertAllowed(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new UpstreamError(`refusing non-HTTPS upstream: ${parsed.protocol}`, url);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new UpstreamError(`upstream host is not allowlisted: ${parsed.hostname}`, url);
  }
  return parsed;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function once(url: string): Promise<string> {
  assertAllowed(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'orbitgene/1.0 (+https://github.com/aniruddhaadak80/orbitgene)',
      },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new UpstreamError(`upstream returned ${response.status}`, url, response.status);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches text with bounded retries. Network blips and 5xx responses are retried;
 * a 4xx is not, because repeating a malformed request cannot help.
 */
export async function fetchText(url: string, label: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= UPSTREAM_RETRIES; attempt += 1) {
    try {
      return await once(url);
    } catch (error) {
      lastError = error;
      const status = error instanceof UpstreamError ? error.status : undefined;
      if (status && status >= 400 && status < 500) break;
      if (attempt < UPSTREAM_RETRIES) await sleep(250 * (attempt + 1));
    }
  }
  throw new UpstreamError(
    `${label} failed after ${UPSTREAM_RETRIES + 1} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    url,
  );
}

export async function fetchJson<T>(url: string, label: string): Promise<T> {
  const text = await fetchText(url, label);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UpstreamError(`${label} returned a body that is not valid JSON`, url);
  }
}

/**
 * A tiny per-process TTL cache. Vercel reuses a warm lambda between requests, so
 * this keeps a viral visit from hammering UniProt while a cold start still pays
 * the real latency.
 */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const store = globalThis as typeof globalThis & {
    __orbitgeneCache?: Map<string, { at: number; value: Promise<T> }>;
  };
  if (!store.__orbitgeneCache) store.__orbitgeneCache = new Map();

  const now = Date.now();
  const hit = store.__orbitgeneCache.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value;

  const value = load().catch((error) => {
    store.__orbitgeneCache?.delete(key);
    throw error;
  });
  store.__orbitgeneCache.set(key, { at: now, value });
  return value;
}

/** Trims a `next.revalidate` compatible TTL to something sane. */
export const TTL = {
  gene: 6 * 60 * 60 * 1000,
  spaceWeather: 15 * 60 * 1000,
  clinvar: 24 * 60 * 60 * 1000,
} as const;