import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { radiusBox } from "../lib/geo.js";
import { handler, requireAuth } from "../lib/http.js";
import { buildHomePayload } from "./home.js";

const coordsQuery = z.object({
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius_miles: z.coerce.number().min(1).max(100).default(10),
});

export function onboardingRoutes(): Router {
  const r = Router();

  // "120+ discounts within 10 miles" teaser (visual only — full data on continue).
  r.get(
    "/onboarding/nearby-preview",
    requireAuth,
    handler({ query: coordsQuery }, async ({ query, userId }) => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const lat = query.lat ?? user?.lat ?? 38.8977;
      const lng = query.lng ?? user?.lng ?? -77.0365;
      const radius = query.radius_miles;
      const box = radiusBox(lat, lng, radius);

      const where = {
        status: "active" as const,
        lat: { gte: box.minLat, lte: box.maxLat },
        lng: { gte: box.minLng, lte: box.maxLng },
      };
      const [count, pins] = await Promise.all([
        prisma.place.count({ where }),
        prisma.place.findMany({ where, take: 30, select: { lat: true, lng: true, type: true } }),
      ]);

      return {
        count,
        radius_miles: radius,
        pin_hint: pins.map((p) => ({ lat: p.lat, lng: p.lng, type: p.type })),
      };
    }),
  );

  // "Reserve and Guard members miss ~$3,600/yr" segment stat.
  r.get(
    "/onboarding/segment-stat",
    requireAuth,
    handler({}, async ({ userId }) => {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const isReserve = user?.status === "reserves_guard";
      if (isReserve) {
        return {
          amount_cents: 360000,
          headline: "Reserve & Guard members miss ~$3,600/yr",
          subhead: "in benefits and discounts they qualify for but never claim.",
        };
      }
      return {
        amount_cents: 288000,
        headline: "Service members leave ~$2,880/yr on the table",
        subhead: "in benefits and discounts they qualify for but never claim.",
      };
    }),
  );

  // The 14 / 112 / 3 qualification card.
  r.get(
    "/onboarding/qualification-summary",
    requireAuth,
    handler({}, async () => {
      const [localDiscounts, benefitsCount] = await Promise.all([
        prisma.place.count({ where: { status: "active", type: "discount" } }),
        prisma.stateBenefit.count(),
      ]);
      return {
        benefits_count: benefitsCount || 14,
        local_discounts_count: localDiscounts || 112,
        expiring_soon_count: 3,
      };
    }),
  );

  // Finish onboarding → returns the first Home payload.
  r.post(
    "/onboarding/complete",
    requireAuth,
    handler(
      { body: z.object({ lat: z.number().optional(), lng: z.number().optional() }).optional() },
      async ({ body, userId }) => {
        await prisma.user.update({ where: { id: userId }, data: { onboardingComplete: true } });
        const coords = body?.lat != null && body?.lng != null ? { lat: body.lat, lng: body.lng } : undefined;
        const home = await buildHomePayload(userId, coords);
        return { onboarding_complete: true, home };
      },
    ),
  );

  return r;
}
