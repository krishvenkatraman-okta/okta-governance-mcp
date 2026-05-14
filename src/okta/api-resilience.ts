/**
 * Okta API resilience: rate limiting, retry with backoff, pagination.
 *
 * Wraps fetch with:
 * - Rate limit header tracking (X-Rate-Limit-Limit/Remaining/Reset)
 * - Proactive throttling when remaining requests are low
 * - Retry on 429 (wait until reset window) and 5xx (exponential backoff)
 * - Auto-pagination via Link header `after` cursor
 *
 * @see https://developer.okta.com/docs/reference/rate-limits/
 * @see https://developer.okta.com/docs/reference/rl-best-practices/
 */

// ─── Rate Limit State ────────────────────────────────────────────────────────

interface RateLimitState {
  limit: number;
  remaining: number;
  resetEpoch: number;
}

const rateLimitState = new Map<string, RateLimitState>();

const THROTTLE_THRESHOLD = 10;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function endpointKey(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/[a-z0-9]{20,}/gi, '/{id}');
  } catch {
    return url;
  }
}

function parseRateLimitHeaders(headers: Headers, key: string): void {
  const limit = headers.get('x-rate-limit-limit');
  const remaining = headers.get('x-rate-limit-remaining');
  const reset = headers.get('x-rate-limit-reset');
  if (limit && remaining && reset) {
    rateLimitState.set(key, {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      resetEpoch: parseInt(reset, 10),
    });
  }
}

async function throttleIfNeeded(key: string): Promise<void> {
  const state = rateLimitState.get(key);
  if (!state || state.remaining > THROTTLE_THRESHOLD) return;

  const waitSec = Math.max(0, state.resetEpoch - Math.floor(Date.now() / 1000));
  if (waitSec > 0 && waitSec < 120) {
    console.log(`[RateLimit] ${state.remaining} remaining, pausing ${waitSec}s until reset`);
    await sleep(waitSec * 1000);
  }
}

async function retryDelay(response: Response, attempt: number): Promise<number> {
  if (response.status === 429) {
    const reset = response.headers.get('x-rate-limit-reset');
    if (reset) {
      const waitSec = Math.max(1, parseInt(reset, 10) - Math.floor(Date.now() / 1000));
      console.log(`[RateLimit] 429 — waiting ${waitSec}s until reset`);
      return waitSec * 1000;
    }
    return 60_000;
  }
  // 5xx: exponential backoff with jitter
  return BASE_BACKOFF_MS * Math.pow(2, attempt) + Math.random() * BASE_BACKOFF_MS;
}

// ─── Resilient Fetch ─────────────────────────────────────────────────────────

export interface ResilientFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Skip retry for non-idempotent writes */
  noRetry?: boolean;
}

/**
 * Fetch with rate limit awareness, proactive throttling, and retry.
 */
export async function resilientFetch(url: string, options: ResilientFetchOptions = {}): Promise<Response> {
  const key = endpointKey(url);
  await throttleIfNeeded(key);

  const maxAttempts = options.noRetry ? 1 : MAX_RETRIES + 1;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const delay = await retryDelay(lastResponse!, attempt - 1);
      console.log(`[Retry] Attempt ${attempt + 1}/${maxAttempts} after ${Math.round(delay / 1000)}s`);
      await sleep(delay);
    }

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
    });
    lastResponse = response;

    parseRateLimitHeaders(response.headers, key);

    // 401: don't retry — token expired
    if (response.status === 401) {
      return response;
    }

    // 429 or 5xx: retry
    if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts - 1) {
      console.warn(`[Retry] ${response.status} on ${key} (remaining: ${response.headers.get('x-rate-limit-remaining')})`);
      continue;
    }

    return response;
  }

  return lastResponse!;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

function parseNextAfter(headers: Headers): string | null {
  const link = headers.get('link');
  if (!link) return null;
  const match = link.match(/<[^>]*[?&]after=(\d+)[^>]*>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * Fetch all pages from a paginated Okta endpoint.
 * Follows Link header `after` cursor with rate limit handling.
 */
export async function fetchAllPages<T>(
  baseUrl: string,
  headers: Record<string, string>,
  pageSize = 50,
  maxPages = 50,
): Promise<T[]> {
  let all: T[] = [];
  let after: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(pageSize));
    if (after) url.searchParams.set('after', after);

    const response = await resilientFetch(url.toString(), { headers });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pagination failed at page ${page + 1}: ${response.status} ${error}`);
    }

    const data = await response.json();
    const items: T[] = Array.isArray(data) ? data : (data as any).data || [];
    all = all.concat(items);

    after = parseNextAfter(response.headers);
    if (!after || items.length < pageSize) break;
  }

  return all;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export function getRateLimitStatus(): Record<string, RateLimitState> {
  const result: Record<string, RateLimitState> = {};
  for (const [k, v] of rateLimitState) result[k] = { ...v };
  return result;
}
