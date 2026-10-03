import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { attachSessionCookie, resolveOwner } from './session';
import type { ApiError } from './types';

/**
 * One request wrapper for every API route.
 *
 * It resolves the anonymous owner, catches unexpected throws, and attaches a
 * freshly minted session cookie when the caller did not have one. Routes stay
 * small because this is the only place that decides status codes for failures,
 * and because an unexpected exception can never leak a stack trace, an
 * environment variable or an internal URL.
 */

export function fail(
  status: number,
  code: string,
  message: string,
  details?: Record<string, string>,
): NextResponse<ApiError> {
  return NextResponse.json(
    { error: details ? { code, message, details } : { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

export function ok<T>(body: T, init?: { status?: number; revalidate?: number }): NextResponse<T> {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: {
      'cache-control':
        init?.revalidate === undefined
          ? 'no-store'
          : `public, s-maxage=${init.revalidate}, stale-while-revalidate=60`,
    },
  });
}

export function fromValidation(error: ZodError): NextResponse<ApiError> {
  const details: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'body';
    if (!details[key]) details[key] = issue.message;
  }
  return fail(400, 'invalid-request', 'The request did not match the expected shape.', details);
}

/**
 * Turns an unexpected throw into a safe response.
 *
 * Upstream and configuration failures get a specific, actionable message;
 * anything else becomes a bare 500 so internals never reach the client.
 */
export function describe(error: unknown): NextResponse<ApiError> {
  const message = error instanceof Error ? error.message : String(error);

  if (/DATABASE_URL|durable store|persistence layer/i.test(message)) {
    return fail(
      503,
      'store-unavailable',
      'The persistence layer is not configured on this deployment.',
    );
  }
  if (/required|unavailable|could not|no sealed sample|not a UniProt|upstream/i.test(message)) {
    return fail(503, 'upstream-unavailable', message);
  }
  if (/not found|does not exist in this session/i.test(message)) {
    return fail(404, 'not-found', message);
  }
  if (/seal/i.test(message)) {
    return fail(409, 'seal-mismatch', message);
  }
  return fail(500, 'internal-error', 'The request could not be completed.');
}

/**
 * Wraps a route handler that needs the anonymous owner id.
 *
 * `handler` returns the intended response, including deliberate `fail(...)` calls,
 * which pass through untouched. Only a throw becomes a generic error.
 */
export async function withOwner(
  request: Request,
  handler: (ownerId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const { ownerId, minted } = await resolveOwner(request);
  let response: NextResponse;
  try {
    response = await handler(ownerId);
  } catch (error) {
    response = describe(error);
  }
  return minted ? attachSessionCookie(response, ownerId) : response;
}

/** Same wrapper for routes that do not need an owner, such as MCP. */
export async function withoutOwner(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return describe(error);
  }
}

export function newIdempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}