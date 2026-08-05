import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { haversineMiles } from "../lib/geo.js";
import { serializePlace } from "./_serializers.js";

export function chainsRoutes(): Router {
  const r = Router();

  // National chains directory grouped by category.
  r.get(
    "/chains",
    requireAuth,
    handler(
      { query: z.object({ category: z.string().optional(), q: z.string().optional() }) },
      async ({ query }) => {
        const where: Prisma.BrandWhereInput = {};
        if (query.category) where.category = query.category;
        if (query.q) where.name = { contains: query.q, mode: "insensitive" };

        const brands = await prisma.brand.findMany({
          where,
          include: { _count: { select: { places: true } } },
          orderBy: { name: "asc" },
        });

        const byCategory = new Map<string, any[]>();
        for (const b of brands) {
          const item = {
            id: b.id,
            name: b.name,
            category: b.category,
            blurb: b.blurb ?? undefined,
            logo_url: b.logoUrl ?? undefined,
            location_count: b._count.places,
            discount_badge: b.discountBadge ?? undefined,
          };
          if (!byCategory.has(b.category)) byCategory.set(b.category, []);
          byCategory.get(b.category)!.push(item);
        }

        return {
          groups: [...byCategory.entries()].map(([category, brandsInCat]) => ({
            category,
            count: brandsInCat.length,
            brands: brandsInCat,
          })),
        };
      },
    ),
  );

  // A brand's nearby locations.
  r.get(
    "/chains/:id/locations",
    requireAuth,
    handler(
      {
        params: z.object({ id: z.string() }),
        query: z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }),
      },
      async ({ params, query }) => {
        const brand = await prisma.brand.findUnique({ where: { id: params.id } });
        if (!brand) throw ApiError.notFound("Chain not found");

        // Fetch the brand's full location set (few thousand max), then sort by
        // distance and return the nearest 100 — an arbitrary take(100) subset
        // would show the wrong "nearby" stores for national chains.
        const places = await prisma.place.findMany({
          where: { brandId: brand.id, status: "active" },
          orderBy: { id: "asc" },
          take: 10000,
        });
        const origin = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : undefined;

        const sorted = (
          origin
            ? places
                .map((p) => ({ p, d: haversineMiles(origin.lat, origin.lng, p.lat, p.lng) }))
                .sort((a, b) => a.d - b.d)
                .map((x) => x.p)
            : places
        ).slice(0, 100);

        return {
          brand: { id: brand.id, name: brand.name, category: brand.category },
          data: sorted.map((p) => serializePlace(p, { origin })),
        };
      },
    ),
  );

  return r;
}
