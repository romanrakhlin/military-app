// Shared credit-card benefit math: parse a product's benefit definitions, apply
// a user's per-period usage, and compute remaining value + next reset. Used by
// the cards endpoints, the reminders feed, and the Home dashboard so the numbers
// always agree.

import { type BenefitPeriod, isBenefitPeriod, periodKey, nextResetDate, daysUntil } from "./periods.js";

export interface BenefitDef {
  id: string;
  name: string;
  description?: string;
  amountCents: number;
  period: BenefitPeriod;
}

export interface BenefitState extends BenefitDef {
  period_key: string;
  next_reset_at: string | null;
  used_amount_cents: number;
  remaining_cents: number;
  days_until_reset: number | null;
}

export interface UsageRow {
  benefitId: string;
  periodKey: string;
  usedAmountCents: number;
}

/** Coerce a product's `benefits` JSON into typed benefit defs, skipping junk. */
export function parseBenefits(raw: unknown): BenefitDef[] {
  if (!Array.isArray(raw)) return [];
  const out: BenefitDef[] = [];
  for (const b of raw) {
    if (!b || typeof b !== "object") continue;
    const o = b as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : undefined;
    const name = typeof o.name === "string" ? o.name : undefined;
    if (!id || !name) continue;
    const period = isBenefitPeriod(o.period) ? o.period : "annual";
    out.push({
      id,
      name,
      description: typeof o.description === "string" ? o.description : undefined,
      amountCents: typeof o.amountCents === "number" ? o.amountCents : 0,
      period,
    });
  }
  return out;
}

/**
 * Compute the live state of each benefit for a card given its usage rows.
 * `anchor` is the cardmember anniversary (UserCard.resetDate) if annual benefits
 * reset on anniversary rather than the calendar.
 */
export function computeBenefitStates(
  benefits: BenefitDef[],
  usages: UsageRow[],
  now: Date,
  anchor?: Date | null,
): BenefitState[] {
  return benefits.map((b) => {
    const key = periodKey(b.period, now);
    const used = usages
      .filter((u) => u.benefitId === b.id && u.periodKey === key)
      .reduce((sum, u) => sum + u.usedAmountCents, 0);
    const reset = nextResetDate(b.period, now, anchor);
    const remaining = Math.max(0, b.amountCents - used);
    return {
      ...b,
      period_key: key,
      next_reset_at: reset ? reset.toISOString() : null,
      used_amount_cents: used,
      remaining_cents: remaining,
      days_until_reset: reset ? daysUntil(reset, now) : null,
    };
  });
}

export interface CardSummary {
  total_value_cents: number; // sum of benefit face values for the current period
  remaining_cents: number; // unused value still available this period
  used_cents: number;
}

export function summarizeBenefits(states: BenefitState[]): CardSummary {
  let total = 0;
  let remaining = 0;
  let used = 0;
  for (const s of states) {
    total += s.amountCents;
    remaining += s.remaining_cents;
    used += s.used_amount_cents;
  }
  return { total_value_cents: total, remaining_cents: remaining, used_cents: used };
}
