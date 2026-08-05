// Cursor pagination helpers. The client sends ?limit=&cursor=, we return
// { data, next_cursor }. Cursors are opaque base64 of the last item id.

export function encodeCursor(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

export function decodeCursor(cursor?: string): string | undefined {
  if (!cursor) return undefined;
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return undefined;
  }
}

export function clampLimit(limit: number | undefined, def = 20, max = 100): number {
  if (!limit || Number.isNaN(limit)) return def;
  return Math.min(Math.max(1, Math.floor(limit)), max);
}

/**
 * Given rows fetched with `take: limit + 1`, split off the extra row and
 * produce the next cursor from the last returned row's id.
 */
export function paginate<T extends { id: string }>(
  rows: T[],
  limit: number,
): { data: T[]; next_cursor: string | null } {
  if (rows.length > limit) {
    const page = rows.slice(0, limit);
    const last = page[page.length - 1]!;
    return { data: page, next_cursor: encodeCursor(last.id) };
  }
  return { data: rows, next_cursor: null };
}
