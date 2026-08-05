import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";
import { haversineMiles, radiusBox, roundMiles } from "../lib/geo.js";

export function healthContentRoutes(): Router {
  const r = Router();

  r.get(
    "/health/resources",
    requireAuth,
    handler(
      { query: z.object({ category: z.string().optional(), state: z.string().optional() }) },
      async ({ query }) => {
        const where: Prisma.HealthResourceWhereInput = {};
        if (query.category) where.category = query.category;
        if (query.state) where.state = query.state.toUpperCase();
        const resources = await prisma.healthResource.findMany({ where, orderBy: { title: "asc" } });
        return {
          data: resources.map((res) => ({
            id: res.id,
            category: res.category,
            state: res.state ?? undefined,
            title: res.title,
            body: res.body ?? undefined,
            source: res.source ?? undefined,
          })),
        };
      },
    ),
  );

  r.get(
    "/health/facilities",
    requireAuth,
    handler(
      {
        query: z.object({
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
          radius: z.coerce.number().min(1).max(200).default(50),
          category: z.string().optional(),
        }),
      },
      async ({ query }) => {
        const { lat, lng, radius, category } = query;
        const where: Prisma.HealthFacilityWhereInput = {};
        if (category) where.category = category;
        if (lat != null && lng != null) {
          const box = radiusBox(lat, lng, radius);
          where.lat = { gte: box.minLat, lte: box.maxLat };
          where.lng = { gte: box.minLng, lte: box.maxLng };
        }
        const facilities = await prisma.healthFacility.findMany({ where, take: 200 });
        const origin = lat != null && lng != null ? { lat, lng } : undefined;
        const items = facilities.map((f) => ({
          id: f.id,
          name: f.name,
          category: f.category ?? undefined,
          address: f.address ?? undefined,
          city: f.city ?? undefined,
          state: f.state ?? undefined,
          lat: f.lat,
          lng: f.lng,
          phone: f.phone ?? undefined,
          distance_miles: origin ? roundMiles(haversineMiles(origin.lat, origin.lng, f.lat, f.lng)) : null,
        }));
        if (origin) items.sort((a, b) => (a.distance_miles ?? 0) - (b.distance_miles ?? 0));
        return { data: items };
      },
    ),
  );

  return r;
}
