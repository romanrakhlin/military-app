import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";

const allocationSchema = z.object({
  G: z.number().min(0).max(100),
  F: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
  S: z.number().min(0).max(100),
  I: z.number().min(0).max(100),
  L: z.number().min(0).max(100),
});

// Long-run illustrative nominal annual returns per TSP fund.
const FUND_RETURNS: Record<string, number> = { G: 0.03, F: 0.04, C: 0.09, S: 0.10, I: 0.08, L: 0.06 };
const SAFE_WITHDRAWAL_RATE = 0.04;

function blendedReturn(alloc: Record<string, number>): number {
  const total = Object.values(alloc).reduce((a, b) => a + b, 0) || 100;
  return Object.entries(alloc).reduce((r, [fund, pct]) => r + (pct / total) * (FUND_RETURNS[fund] ?? 0.05), 0);
}

export function tspRoutes(): Router {
  const r = Router();

  r.get(
    "/tsp",
    requireAuth,
    handler({}, async ({ userId }) => {
      const snap = await prisma.tspSnapshot.findUnique({ where: { userId } });
      if (!snap) {
        return { balance_cents: 0, contribution_pct: 0, allocation: { G: 0, F: 0, C: 0, S: 0, I: 0, L: 0 }, updated_at: null };
      }
      return {
        balance_cents: snap.balanceCents,
        contribution_pct: snap.contributionPct,
        allocation: snap.allocation,
        updated_at: snap.updatedAt.toISOString(),
      };
    }),
  );

  r.put(
    "/tsp",
    requireAuth,
    handler(
      {
        body: z.object({
          balance_cents: z.number().int().min(0).max(2_000_000_000),
          contribution_pct: z.number().min(0).max(100),
          allocation: allocationSchema,
        }),
      },
      async ({ body: b, userId }) => {
        const snap = await prisma.tspSnapshot.upsert({
          where: { userId },
          create: { userId, balanceCents: b.balance_cents, contributionPct: b.contribution_pct, allocation: b.allocation },
          update: { balanceCents: b.balance_cents, contributionPct: b.contribution_pct, allocation: b.allocation },
        });
        await prisma.user.update({ where: { id: userId }, data: { knowsTsp: true } });
        return {
          balance_cents: snap.balanceCents,
          contribution_pct: snap.contributionPct,
          allocation: snap.allocation,
          updated_at: snap.updatedAt.toISOString(),
        };
      },
    ),
  );

  r.post(
    "/calc/tsp/project",
    requireAuth,
    handler(
      {
        body: z.object({
          balance_cents: z.number().int().min(0).max(2_000_000_000),
          contribution_pct: z.number().min(0).max(100),
          allocation: allocationSchema,
          horizon: z.number().int().min(1).max(60),
          annual_income_cents: z.number().int().min(0).max(2_000_000_000).optional(),
        }),
      },
      async ({ body: b }) => {
        const rate = blendedReturn(b.allocation as Record<string, number>);
        const annualContribution = Math.round((b.annual_income_cents ?? 0) * (b.contribution_pct / 100));

        const series: { year: number; balance_cents: number }[] = [];
        let balance = b.balance_cents;
        series.push({ year: 0, balance_cents: Math.round(balance) });
        for (let year = 1; year <= b.horizon; year++) {
          balance = balance * (1 + rate) + annualContribution;
          series.push({ year, balance_cents: Math.round(balance) });
        }

        const projected = Math.round(balance);
        const estMonthlyIncome = Math.round((projected * SAFE_WITHDRAWAL_RATE) / 12);

        return {
          series,
          projected_balance_cents: projected,
          est_monthly_retirement_income_cents: estMonthlyIncome,
          assumptions: {
            blended_annual_return: Math.round(rate * 10000) / 10000,
            annual_contribution_cents: annualContribution,
            safe_withdrawal_rate: SAFE_WITHDRAWAL_RATE,
            fund_returns: FUND_RETURNS,
          },
          disclaimer:
            "Projections are illustrative estimates based on assumed long-run returns and are not guarantees of future performance.",
        };
      },
    ),
  );

  return r;
}
