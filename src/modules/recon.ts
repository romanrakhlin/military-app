import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { radiusBox } from "../lib/geo.js";
import { handler, requireAuth } from "../lib/http.js";

// Recon: discount + free-benefit categories with counts near the user.
export function reconRoutes(): Router {
  const r = Router();

  r.get(
    "/recon",
    requireAuth,
    handler(
      {
        query: z.object({
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
          channel: z.enum(["online", "local"]).default("local"),
          radius: z.coerce.number().min(1).max(200).default(25),
        }),
      },
      async ({ query }) => {
        const { lat, lng, channel, radius } = query;
        const base: Prisma.PlaceWhereInput = { status: "active" };
        if (channel === "online") {
          base.channel = { in: ["online", "both"] };
        } else if (lat != null && lng != null) {
          const box = radiusBox(lat, lng, radius);
          base.lat = { gte: box.minLat, lte: box.maxLat };
          base.lng = { gte: box.minLng, lte: box.maxLng };
        }

        const grouped = await prisma.place.groupBy({
          by: ["type", "category"],
          where: base,
          _count: { _all: true },
        });

        const discounts: { category: string; count: number }[] = [];
        const free: { category: string; count: number }[] = [];
        for (const g of grouped) {
          const entry = { category: g.category, count: g._count._all };
          if (g.type === "discount") discounts.push(entry);
          else free.push(entry);
        }
        discounts.sort((a, b) => b.count - a.count);
        free.sort((a, b) => b.count - a.count);

        return {
          channel,
          discount_categories: discounts,
          free_benefit_categories: free,
          total: grouped.reduce((sum, g) => sum + g._count._all, 0),
        };
      },
    ),
  );

  return r;
}
