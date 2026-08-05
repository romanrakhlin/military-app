// Tiny fetch helper for ingestion: JSON GET with retry + clear errors.
// Uses Node 22's global fetch.

export async function getJson<T>(url: string, headers: Record<string, string>, attempt = 0): Promise<T> {
  const maxAttempts = 4;
  try {
    const res = await fetch(url, { headers: { accept: "application/json", ...headers } });
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`transient ${res.status}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${url} → ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (attempt < maxAttempts && /transient|fetch failed|ECONNRESET|ETIMEDOUT/i.test(String(err))) {
      const backoff = 500 * 2 ** attempt;
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
