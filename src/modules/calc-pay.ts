import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { computePay, payOptions } from "../data/pay.js";
import { VALID_RATINGS, computeVaDisability } from "../data/va.js";

export function payRoutes(): Router {
  const r = Router();

  r.get(
    "/calc/pay/options",
    requireAuth,
    handler({}, async () => payOptions()),
  );

  r.post(
    "/calc/pay",
    requireAuth,
    handler(
      {
        body: z.object({
          branch: z.string().optional(),
          pay_grade: z.string(),
          years_served: z.number().int().min(0).max(50),
          zip: z.string().optional(),
          dependents: z.number().int().min(0).max(20).default(0),
          married: z.boolean().default(false),
          lives_on_base: z.boolean().default(false),
          special_pays: z.array(z.object({ id: z.string(), monthly_cents: z.number().int().min(0) })).default([]),
          additional_income_cents: z.number().int().min(0).default(0),
          deductions_cents: z.number().int().min(0).default(0),
          tsp_contribution_pct: z.number().min(0).max(100).default(0),
          state_of_residence: z.string().optional(),
          data_year: z.number().int().optional(),
        }),
      },
      async ({ body: b }) => {
        const specialPaysCents = b.special_pays.reduce((sum, s) => sum + s.monthly_cents, 0);
        return computePay({
          branch: b.branch,
          payGrade: b.pay_grade,
          yearsServed: b.years_served,
          zip: b.zip,
          dependents: b.dependents,
          married: b.married,
          livesOnBase: b.lives_on_base,
          specialPaysCents,
          additionalIncomeCents: b.additional_income_cents,
          deductionsCents: b.deductions_cents,
          tspContributionPct: b.tsp_contribution_pct,
          stateOfResidence: b.state_of_residence,
        });
      },
    ),
  );

  r.get(
    "/calc/pay/summary",
    requireAuth,
    handler({}, async ({ userId }) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { branch: true, payGrade: true, yearsServed: true, zip: true },
      });
      if (!user) throw ApiError.notFound("User not found");
      if (!user.payGrade) throw ApiError.badRequest("Set your pay grade in your profile first", "pay_grade");

      const [profile, monthlyBills] = await Promise.all([
        prisma.payProfile.findUnique({ where: { userId } }),
        prisma.monthlyBill.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
      ]);

      const specialPays = Array.isArray(profile?.specialPays) ? (profile!.specialPays as unknown[]) : [];
      const specialPaysCents = specialPays.reduce<number>((sum, s) => {
        const cents = (s as { monthly_cents?: unknown })?.monthly_cents;
        return sum + (typeof cents === "number" ? cents : 0);
      }, 0);

      const pay = computePay({
        branch: user.branch ?? undefined,
        payGrade: user.payGrade,
        yearsServed: user.yearsServed ?? 0,
        zip: user.zip ?? undefined,
        dependents: profile?.dependents ?? 0,
        married: profile?.married ?? false,
        livesOnBase: profile?.livesOnBase ?? false,
        specialPaysCents,
        additionalIncomeCents: profile?.additionalIncomeCents ?? 0,
        stateOfResidence: profile?.stateOfResidence ?? undefined,
      });

      const vaMonthly =
        profile?.vaRating != null && VALID_RATINGS.includes(profile.vaRating)
          ? computeVaDisability({
              rating: profile.vaRating,
              married: profile.vaMarried,
              children: profile.vaChildren,
              dependentParents: profile.vaDependentParents,
            }).monthly_cents
          : 0;

      const billsTotal = monthlyBills.reduce((sum, b) => sum + b.amountCents, 0);

      return {
        ...pay,
        va_disability_monthly_cents: vaMonthly,
        monthly_bills_total_cents: billsTotal,
        remaining_after_bills_cents: pay.take_home.monthly + vaMonthly - billsTotal,
        estimated_total_income_cents: pay.take_home.monthly + vaMonthly,
      };
    }),
  );

  return r;
}
