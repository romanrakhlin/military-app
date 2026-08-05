// Benefit reset-period math. Card credits reset on different cadences; this
// computes the current period key (for usage bookkeeping) and the next reset
// date (for reminders + calendar sync). Calendar-based cadence by default; pass
// an `anchor` (cardmember anniversary) for annual anniversary resets.

export type BenefitPeriod = "monthly" | "quarterly" | "semiannual" | "annual" | "one_time";

export const BENEFIT_PERIODS: BenefitPeriod[] = [
  "monthly",
  "quarterly",
  "semiannual",
  "annual",
  "one_time",
];

export function isBenefitPeriod(v: unknown): v is BenefitPeriod {
  return typeof v === "string" && (BENEFIT_PERIODS as string[]).includes(v);
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/** Stable key identifying the period that `date` falls into. */
export function periodKey(period: BenefitPeriod, date: Date): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0-11
  switch (period) {
    case "monthly":
      return `${y}-${String(m + 1).padStart(2, "0")}`;
    case "quarterly":
      return `${y}-Q${Math.floor(m / 3) + 1}`;
    case "semiannual":
      return `${y}-H${m < 6 ? 1 : 2}`;
    case "annual":
      return `${y}`;
    case "one_time":
      return "once";
  }
}

/**
 * The next reset date (exclusive upper bound of the current period). For
 * one_time benefits there is no reset → null. When `anchor` is given, annual
 * benefits reset on that month/day anniversary instead of Jan 1.
 */
export function nextResetDate(period: BenefitPeriod, from: Date, anchor?: Date | null): Date | null {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth();
  switch (period) {
    case "monthly":
      return m === 11 ? utc(y + 1, 0, 1) : utc(y, m + 1, 1);
    case "quarterly": {
      const nextQStartMonth = (Math.floor(m / 3) + 1) * 3;
      return nextQStartMonth >= 12 ? utc(y + 1, 0, 1) : utc(y, nextQStartMonth, 1);
    }
    case "semiannual":
      return m < 6 ? utc(y, 6, 1) : utc(y + 1, 0, 1);
    case "annual": {
      if (anchor) {
        const am = anchor.getUTCMonth();
        const ad = anchor.getUTCDate();
        const candidate = utc(y, am, ad);
        return candidate > from ? candidate : utc(y + 1, am, ad);
      }
      return utc(y + 1, 0, 1);
    }
    case "one_time":
      return null;
  }
}

/** Whole days from `from` until `date` (rounded up, min 0). */
export function daysUntil(date: Date, from: Date): number {
  const ms = date.getTime() - from.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
