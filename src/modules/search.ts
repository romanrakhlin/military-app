import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { radiusBox } from "../lib/geo.js";
import { handler, requireAuth } from "../lib/http.js";
import { serializePlace } from "./_serializers.js";

// Global search → grouped results.
export function searchRoutes(): Router {
  const r = Router();

  r.get(
    "/search",
    requireAuth,
    handler(
      {
        query: z.object({
          q: z.string().min(1),
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
        }),
      },
      async ({ query }) => {
        const { q, lat, lng } = query;
        const origin = lat != null && lng != null ? { lat, lng } : undefined;
        const nameMatch = { name: { contains: q, mode: "insensitive" as const } };

        const nearWhere =
          origin != null
            ? (() => {
                const box = radiusBox(origin.lat, origin.lng, 25);
                return {
                  status: "active" as const,
                  ...nameMatch,
                  lat: { gte: box.minLat, lte: box.maxLat },
                  lng: { gte: box.minLng, lte: box.maxLng },
                };
              })()
            : { status: "active" as const, ...nameMatch };

        const [nearYou, onlineOffers, freeResources, benefits, guides] = await Promise.all([
          prisma.place.findMany({ where: { ...nearWhere, type: "discount" }, take: 10 }),
          prisma.place.findMany({
            where: { status: "active", type: "discount", channel: { in: ["online", "both"] }, ...nameMatch },
            take: 10,
          }),
          prisma.place.findMany({ where: { status: "active", type: "free", ...nameMatch }, take: 10 }),
          prisma.stateBenefit.findMany({
            where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { category: { contains: q, mode: "insensitive" } }] },
            take: 10,
          }),
          prisma.article.findMany({
            where: { OR: [{ title: { contains: q, mode: "insensitive" } }, { tag: { contains: q, mode: "insensitive" } }] },
            take: 10,
          }),
        ]);

        return {
          query: q,
          near_you: nearYou.map((p) => serializePlace(p, { origin })),
          online_offers: onlineOffers.map((p) => serializePlace(p, { origin })),
          free_resources: freeResources.map((p) => serializePlace(p, { origin })),
          benefits: benefits.map((b) => ({ id: b.id, title: b.title, state: b.state, category: b.category })),
          guides: guides.map((a) => ({ id: a.id, title: a.title, emoji: a.emoji ?? "📰", read_minutes: a.readMinutes })),
        };
      },
    ),
  );

  return r;
}
