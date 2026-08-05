import { Router } from "express";
import type { MonthlyBill, PayProfile } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { VALID_RATINGS, computeVaDisability } from "../data/va.js";

interface SpecialPay {
  id: string;
  monthly_cents: number;
}

// Upper bound keeps every cents value inside Postgres Int4 (and keeps summed
// incomes sane) — otherwise oversized input 500s at the DB instead of 400ing.
const MAX_CENTS = 2_000_000_000;

const specialPaySchema = z.object({ id: z.string().max(50), monthly_cents: z.number().int().min(0).max(MAX_CENTS) });

function readSpecialPays(profile: PayProfile | null): SpecialPay[] {
  if (!profile) return [];
  const raw = profile.specialPays as unknown;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is SpecialPay => !!s && typeof s === "object")
    .map((s) => ({ id: String((s as SpecialPay).id), monthly_cents: Number((s as SpecialPay).monthly_cents) }));
}

function serializeBill(bill: MonthlyBill) {
  return {
    id: bill.id,
    label: bill.label,
    amount_cents: bill.amountCents,
    category: bill.category ?? undefined,
    created_at: bill.createdAt.toISOString(),
  };
}

function serializeProfile(profile: PayProfile | null, bills: MonthlyBill[]) {
  const specialPays = readSpecialPays(profile);
  const rating = profile?.vaRating ?? null;
  const ratingValid = rating != null && VALID_RATINGS.includes(rating);
  const va = ratingValid
    ? computeVaDisability({
        rating: rating!,
        married: profile!.vaMarried,
        children: profile!.vaChildren,
        dependentParents: profile!.vaDependentParents,
      })
    : null;

  const billsTotal = bills.reduce((sum, b) => sum + b.amountCents, 0);

  return {
    dependents: profile?.dependents ?? 0,
    married: profile?.married ?? false,
    lives_on_base: profile?.livesOnBase ?? false,
    special_pays: specialPays,
    additional_income_cents: profile?.additionalIncomeCents ?? 0,
    state_of_residence: profile?.stateOfResidence ?? null,
    va: {
      rating: rating,
      married: profile?.vaMarried ?? false,
      children: profile?.vaChildren ?? 0,
      dependent_parents: profile?.vaDependentParents ?? 0,
      monthly_cents: va ? va.monthly_cents : 0,
      annual_cents: va ? va.annual_cents : 0,
    },
    monthly_bills: bills.map(serializeBill),
    monthly_bills_total_cents: billsTotal,
    updated_at: profile ? profile.updatedAt.toISOString() : null,
  };
}

async function loadProfileAndBills(userId: string) {
  const [profile, bills] = await Promise.all([
    prisma.payProfile.findUnique({ where: { userId } }),
    prisma.monthlyBill.findMany({ where: { userId }, orderBy: { createdAt: "asc" } }),
  ]);
  return { profile, bills };
}

const putProfileSchema = z.object({
  dependents: z.number().int().min(0).max(20).optional(),
  married: z.boolean().optional(),
  lives_on_base: z.boolean().optional(),
  special_pays: z.array(specialPaySchema).max(20).optional(),
  additional_income_cents: z.number().int().min(0).max(MAX_CENTS).optional(),
  state_of_residence: z.string().max(20).optional(),
  va_rating: z.number().int().optional(),
  va_married: z.boolean().optional(),
  va_children: z.number().int().min(0).max(20).optional(),
  va_dependent_parents: z.number().int().min(0).max(2).optional(),
});

const postBillSchema = z.object({
  label: z.string().min(1).max(100),
  amount_cents: z.number().int().min(0).max(MAX_CENTS),
  category: z.string().max(100).optional(),
});

export function payProfileRoutes(): Router {
  const r = Router();

  r.get(
    "/pay/profile",
    requireAuth,
    handler({}, async ({ userId }) => {
      const { profile, bills } = await loadProfileAndBills(userId);
      return serializeProfile(profile, bills);
    }),
  );

  r.put(
    "/pay/profile",
    requireAuth,
    handler({ body: putProfileSchema }, async ({ body: b, userId }) => {
      if (b.va_rating !== undefined && !VALID_RATINGS.includes(b.va_rating)) {
        throw ApiError.badRequest("Invalid VA disability rating", "va_rating");
      }

      const data: Record<string, unknown> = {};
      if (b.dependents !== undefined) data.dependents = b.dependents;
      if (b.married !== undefined) data.married = b.married;
      if (b.lives_on_base !== undefined) data.livesOnBase = b.lives_on_base;
      if (b.special_pays !== undefined) data.specialPays = b.special_pays;
      if (b.additional_income_cents !== undefined) data.additionalIncomeCents = b.additional_income_cents;
      if (b.state_of_residence !== undefined) data.stateOfResidence = b.state_of_residence;
      if (b.va_rating !== undefined) data.vaRating = b.va_rating;
      if (b.va_married !== undefined) data.vaMarried = b.va_married;
      if (b.va_children !== undefined) data.vaChildren = b.va_children;
      if (b.va_dependent_parents !== undefined) data.vaDependentParents = b.va_dependent_parents;

      await prisma.payProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });

      const { profile, bills } = await loadProfileAndBills(userId);
      return serializeProfile(profile, bills);
    }),
  );

  r.get(
    "/pay/bills",
    requireAuth,
    handler({}, async ({ userId }) => {
      const bills = await prisma.monthlyBill.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
      return {
        data: bills.map(serializeBill),
        total_cents: bills.reduce((sum, b) => sum + b.amountCents, 0),
      };
    }),
  );

  r.post(
    "/pay/bills",
    requireAuth,
    handler({ body: postBillSchema }, async ({ body: b, userId, res }) => {
      const bill = await prisma.monthlyBill.create({
        data: { userId, label: b.label, amountCents: b.amount_cents, category: b.category },
      });
      res.status(201).json(serializeBill(bill));
      return undefined;
    }),
  );

  r.delete(
    "/pay/bills/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId, res }) => {
      const result = await prisma.monthlyBill.deleteMany({ where: { id: params.id, userId } });
      if (result.count === 0) throw ApiError.notFound("Bill not found");
      res.status(204).end();
      return undefined;
    }),
  );

  return r;
}
