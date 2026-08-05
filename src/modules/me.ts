import { Router } from "express";
import type { User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { isValidPayGrade } from "../data/pay.js";

const allocationSchema = z.object({
  G: z.number().min(0).max(100),
  F: z.number().min(0).max(100),
  C: z.number().min(0).max(100),
  S: z.number().min(0).max(100),
  I: z.number().min(0).max(100),
  L: z.number().min(0).max(100),
});

const patchMeSchema = z
  .object({
    status: z.enum(["active", "veteran", "retired", "reserves_guard", "family"]).optional(),
    branch: z.enum(["army", "navy", "air_force", "marines", "coast_guard", "space_force"]).optional(),
    reserve_component: z.string().max(50).optional(),
    duty_status: z.string().max(50).optional(),
    pay_category: z.enum(["enlisted", "warrant", "officer"]).optional(),
    pay_grade: z.string().refine(isValidPayGrade, "Unknown pay grade — see /calc/pay/options").optional(),
    years_served: z.number().int().min(0).max(50).optional(),
    goal: z.string().max(200).optional(),
    zip: z.string().min(3).max(10).optional(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional(),
    knows_tsp: z.boolean().optional(),
    tsp: z
      .object({
        balance_cents: z.number().int().min(0).max(2_000_000_000),
        contribution_pct: z.number().min(0).max(100),
        allocation: allocationSchema,
      })
      .optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .strict();

export function serializeUser(user: User & { tsp?: unknown }) {
  const tsp = (user as any).tsp;
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    onboarding_complete: user.onboardingComplete,
    status: user.status ?? undefined,
    branch: user.branch ?? undefined,
    reserve_component: user.reserveComponent ?? undefined,
    duty_status: user.dutyStatus ?? undefined,
    pay_category: user.payCategory ?? undefined,
    pay_grade: user.payGrade ?? undefined,
    years_served: user.yearsServed ?? undefined,
    goal: user.goal ?? undefined,
    zip: user.zip ?? undefined,
    location: user.lat != null && user.lng != null ? { lat: user.lat, lng: user.lng } : undefined,
    knows_tsp: user.knowsTsp,
    tsp: tsp
      ? {
          balance_cents: tsp.balanceCents,
          contribution_pct: tsp.contributionPct,
          allocation: tsp.allocation,
        }
      : undefined,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

async function loadUserOr404(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { tsp: true } });
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

export function meRoutes(): Router {
  const r = Router();

  r.get(
    "/me",
    requireAuth,
    handler({}, async ({ userId }) => serializeUser(await loadUserOr404(userId))),
  );

  r.patch(
    "/me",
    requireAuth,
    handler({ body: patchMeSchema }, async ({ body: b, userId }) => {
      const data: Record<string, unknown> = {};
      if (b.status !== undefined) data.status = b.status;
      if (b.branch !== undefined) data.branch = b.branch;
      if (b.pay_category !== undefined) data.payCategory = b.pay_category;
      if (b.pay_grade !== undefined) data.payGrade = b.pay_grade;
      if (b.years_served !== undefined) data.yearsServed = b.years_served;
      if (b.goal !== undefined) data.goal = b.goal;
      if (b.zip !== undefined) data.zip = b.zip;
      if (b.knows_tsp !== undefined) data.knowsTsp = b.knows_tsp;
      if (b.name !== undefined) data.name = b.name;

      // reserve_component / duty_status only meaningful for reserves_guard
      if (b.reserve_component !== undefined) data.reserveComponent = b.reserve_component;
      if (b.duty_status !== undefined) data.dutyStatus = b.duty_status;

      if (b.location) {
        data.lat = b.location.lat;
        data.lng = b.location.lng;
      }

      // Profile + TSP snapshot commit together or not at all.
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data }),
        ...(b.tsp
          ? [
              prisma.tspSnapshot.upsert({
                where: { userId },
                create: {
                  userId,
                  balanceCents: b.tsp.balance_cents,
                  contributionPct: b.tsp.contribution_pct,
                  allocation: b.tsp.allocation,
                },
                update: {
                  balanceCents: b.tsp.balance_cents,
                  contributionPct: b.tsp.contribution_pct,
                  allocation: b.tsp.allocation,
                },
              }),
            ]
          : []),
      ]);

      return serializeUser(await loadUserOr404(userId));
    }),
  );

  r.get(
    "/me/export",
    requireAuth,
    handler({}, async ({ userId }) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { tsp: true, cards: true, favorites: true, uploads: true, createdPlaces: true, deviceTokens: true },
      });
      if (!user) throw ApiError.notFound("User not found");
      const { passwordHash, ...safe } = user;
      void passwordHash;
      return { exported_at: new Date().toISOString(), profile: serializeUser(user), raw: safe };
    }),
  );

  return r;
}
