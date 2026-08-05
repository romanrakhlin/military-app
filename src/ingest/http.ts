// Tiny fetch helper for ingestion: JSON GET with timeout, retry + clear errors.
// Uses Node 22's global fetch.

const REQUEST_TIMEOUT_MS = 15_000;

export async function getJson<T>(url: string, headers: Record<string, string>, attempt = 0): Promise<T> {
  const maxAttempts = 4;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) {
      // Surface Retry-After so the backoff below can honor rate-limit windows.
      const retryAfterSec = Number(res.headers.get("retry-after"));
      const err = new Error(`transient ${res.status}`) as Error & { retryAfterMs?: number };
      if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) err.retryAfterMs = Math.min(retryAfterSec, 60) * 1000;
      throw err;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${url} → ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    const desc = `${(err as Error)?.name ?? ""} ${String(err)}`;
    if (attempt < maxAttempts && /transient|fetch failed|ECONNRESET|ETIMEDOUT|TimeoutError|AbortError/i.test(desc)) {
      const backoff = (err as { retryAfterMs?: number })?.retryAfterMs ?? 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, backoff));
      return getJson<T>(url, headers, attempt + 1);
    }
    throw err;
  }
}

export function firstNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}
