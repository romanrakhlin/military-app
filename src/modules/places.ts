import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { clampLimit } from "../lib/pagination.js";
import { radiusBox, haversineMiles } from "../lib/geo.js";
import { serializePlace } from "./_serializers.js";

const listQuery = z.object({
  type: z.enum(["discount", "free"]).optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  filter: z.string().optional(),
  sort: z.enum(["distance", "recent", "confirmations"]).default("distance"),
  q: z.string().optional(),
  // bbox: "minLng,minLat,maxLng,maxLat"
  bbox: z.string().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radius: z.coerce.number().min(0.1).max(500).default(25),
  limit: z.coerce.number().optional(),
  cursor: z.string().optional(),
});

function parseBbox(bbox?: string) {
  if (!bbox) return undefined;
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return undefined;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  return { minLat, minLng, maxLat, maxLng };
}

async function favoriteIdsFor(userId: string, placeIds: string[]): Promise<Set<string>> {
  if (placeIds.length === 0) return new Set();
  const rows = await prisma.favorite.findMany({
    where: { userId, placeId: { in: placeIds } },
    select: { placeId: true },
  });
  return new Set(rows.map((r) => r.placeId));
}

export function placesRoutes(): Router {
  const r = Router();

  r.get(
    "/places",
    requireAuth,
    handler({ query: listQuery }, async ({ query: q, userId }) => {
      const limit = clampLimit(q.limit);
      // A client-supplied bbox (map viewport) defines the area exactly; the
      // radius only applies when we derived the box from a lat/lng center.
      const clientBox = parseBbox(q.bbox);
      const box = clientBox ?? (q.lat != null && q.lng != null ? radiusBox(q.lat, q.lng, q.radius) : undefined);
      const origin = q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined;

      const where: Prisma.PlaceWhereInput = { status: "active" };
      if (q.type) where.type = q.type;
      if (q.category) where.category = q.category;
      if (q.subcategory) where.subcategory = q.subcategory;
      if (q.filter === "verified") where.verificationStatus = "verified";
      if (q.filter === "favorites") where.favorites = { some: { userId } };
      if (q.q) {
        where.OR = [
          { name: { contains: q.q, mode: "insensitive" } },
          { category: { contains: q.q, mode: "insensitive" } },
          { city: { contains: q.q, mode: "insensitive" } },
        ];
      }
      if (box) {
        where.lat = { gte: box.minLat, lte: box.maxLat };
        where.lng = { gte: box.minLng, lte: box.maxLng };
      }

      // Distance sort requires in-memory ordering; use a numeric offset cursor.
      if (q.sort === "distance" && origin) {
        const rawOffset = q.cursor ? Number(Buffer.from(q.cursor, "base64url").toString("utf8")) : 0;
        const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
        // Deterministic candidate set: stable order so successive pages see the
        // same rows. The whole table is a few thousand rows; the box narrows it.
        const candidates = await prisma.place.findMany({ where, orderBy: { id: "asc" }, take: 5000 });
        const withDistance = candidates
          .map((p) => ({ p, d: haversineMiles(origin.lat, origin.lng, p.lat, p.lng) }))
          // Radius applies only to center searches; a client bbox is exact.
          .filter((x) => (clientBox ? true : x.d <= q.radius))
          .sort((a, b) => a.d - b.d || (a.p.id < b.p.id ? -1 : 1));
        const pageRows = withDistance.slice(offset, offset + limit);
        const favIds = await favoriteIdsFor(userId, pageRows.map((x) => x.p.id));
        const nextOffset = offset + limit;
        return {
          data: pageRows.map((x) => serializePlace(x.p, { origin, favoriteIds: favIds })),
          count_in_area: withDistance.length,
          next_cursor:
            nextOffset < withDistance.length
              ? Buffer.from(String(nextOffset), "utf8").toString("base64url")
              : null,
        };
      }

      const countInArea = await prisma.place.count({ where });

      // Non-distance sort: keyset by id/createdAt.
      const orderBy: Prisma.PlaceOrderByWithRelationInput =
        q.sort === "confirmations" ? { confirmations: "desc" } : { createdAt: "desc" };
      const cursorId = q.cursor ? Buffer.from(q.cursor, "base64url").toString("utf8") : undefined;
      const rows = await prisma.place.findMany({
        where,
        orderBy: [orderBy, { id: "desc" }],
        take: limit + 1,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const favIds = await favoriteIdsFor(userId, page.map((p) => p.id));
      return {
        data: page.map((p) => serializePlace(p, { origin, favoriteIds: favIds })),
        count_in_area: countInArea,
        next_cursor: hasMore ? Buffer.from(page[page.length - 1]!.id, "utf8").toString("base64url") : null,
      };
    }),
  );

  // Find nearest single place (optionally filtered by type/category).
  r.get(
    "/places/nearest",
    requireAuth,
    handler(
      {
        query: z.object({
          lat: z.coerce.number(),
          lng: z.coerce.number(),
          type: z.enum(["discount", "free"]).optional(),
          category: z.string().optional(),
        }),
      },
      async ({ query, userId }) => {
        const { lat, lng, type, category } = query;
        const box = radiusBox(lat, lng, 100);
        const where: Prisma.PlaceWhereInput = {
          status: "active",
          lat: { gte: box.minLat, lte: box.maxLat },
          lng: { gte: box.minLng, lte: box.maxLng },
        };
        if (type) where.type = type;
        if (category) where.category = category;
        const candidates = await prisma.place.findMany({ where, take: 300 });
        if (candidates.length === 0) throw ApiError.notFound("No places found nearby");
        const nearest = candidates
          .map((p) => ({ p, d: haversineMiles(lat, lng, p.lat, p.lng) }))
          .sort((a, b) => a.d - b.d)[0]!;
        const favIds = await favoriteIdsFor(userId, [nearest.p.id]);
        return serializePlace(nearest.p, { origin: { lat, lng }, favoriteIds: favIds });
      },
    ),
  );

  r.get(
    "/places/:id",
    requireAuth,
    handler(
      {
        params: z.object({ id: z.string() }),
        query: z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }),
      },
      async ({ params, query, userId }) => {
        const place = await prisma.place.findUnique({ where: { id: params.id } });
        // Pre-moderation submissions are visible only to their submitter.
        if (!place || (place.status !== "active" && place.createdByUserId !== userId)) {
          throw ApiError.notFound("Place not found");
        }
        const origin = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : undefined;
        const favIds = await favoriteIdsFor(userId, [place.id]);
        return serializePlace(place, { origin, favoriteIds: favIds });
      },
    ),
  );

  // Community-add: enters moderation as community_reported.
  r.post(
    "/places",
    requireAuth,
    handler(
      {
        body: z.object({
          type: z.enum(["discount", "free"]),
          name: z.string().min(1).max(200),
          address: z.string().min(1).max(300),
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          category: z.string().min(1).max(100),
          subcategory: z.string().max(100).optional(),
          city: z.string().max(100).optional(),
          discount: z.object({
            summary: z.string().max(500),
            value_type: z.enum(["percent", "fixed", "bogo", "free"]).optional(),
            value: z.number().optional(),
            eligibility: z.array(z.string()).default([]),
            proof_required: z.boolean().default(false),
            channel: z.enum(["in_store", "online", "both"]).optional(),
          }),
          description: z.string().max(1000).optional(),
          website: z.string().url().optional(),
          photo_upload_id: z.string().optional(),
          last_used_on: z.string().datetime().optional(),
        }),
      },
      async ({ body: b, userId, res }) => {
        // Per-user submission cap — community adds go to moderation anyway,
        // so a runaway client/spammer gets stopped here, not in the queue.
        const recentSubmissions = await prisma.place.count({
          where: { createdByUserId: userId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        });
        if (recentSubmissions >= 20) {
          throw ApiError.tooMany("Daily submission limit reached — try again tomorrow");
        }

        // Simple server-side dedupe: same name within ~0.5mi already reported.
        const box = radiusBox(b.lat, b.lng, 0.5);
        const dupe = await prisma.place.findFirst({
          where: {
            name: { equals: b.name, mode: "insensitive" },
            lat: { gte: box.minLat, lte: box.maxLat },
            lng: { gte: box.minLng, lte: box.maxLng },
          },
        });
        if (dupe) throw ApiError.conflict("A matching place already exists", "name");

        const place = await prisma.place.create({
          data: {
            type: b.type,
            name: b.name,
            address: b.address,
            city: b.city,
            lat: b.lat,
            lng: b.lng,
            category: b.category,
            subcategory: b.subcategory,
            discountSummary: b.discount.summary || b.description,
            discountValueType: b.discount.value_type,
            discountValue: b.discount.value,
            eligibility: b.discount.eligibility,
            proofRequired: b.discount.proof_required,
            channel: b.discount.channel,
            website: b.website,
            status: "community_reported",
            verificationStatus: "community",
            createdByUserId: userId,
            lastUsedOn: b.last_used_on ? new Date(b.last_used_on) : undefined,
          },
        });
        res.status(201).json(serializePlace(place, {}));
      },
    ),
  );

  // "I got this discount" — increments confirmations, bumps verification.
  r.post(
    "/places/:id/confirm",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const place = await prisma.place.findUnique({ where: { id: params.id } });
      // Only live places accumulate confirmations — otherwise a submitter's
      // sock puppets could "verify" their own pending entry pre-moderation.
      if (!place || place.status !== "active") throw ApiError.notFound("Place not found");

      await prisma.placeConfirmation.upsert({
        where: { placeId_userId: { placeId: place.id, userId } },
        create: { placeId: place.id, userId },
        update: {},
      });
      const confirmations = await prisma.placeConfirmation.count({ where: { placeId: place.id } });
      const updated = await prisma.place.update({
        where: { id: place.id },
        data: {
          confirmations,
          lastVerifiedAt: new Date(),
          verificationStatus: confirmations >= 3 ? "verified" : place.verificationStatus,
        },
      });
      return serializePlace(updated, {});
    }),
  );

  r.post(
    "/places/:id/report",
    requireAuth,
    handler(
      {
        params: z.object({ id: z.string() }),
        body: z.object({ reason: z.string().min(1).max(200), comment: z.string().max(1000).optional() }),
      },
      async ({ params, body, userId }) => {
        const place = await prisma.place.findUnique({ where: { id: params.id } });
        if (!place) throw ApiError.notFound("Place not found");
        // One report per user per place (unique constraint); re-reporting
        // updates the reason instead of piling on rows.
        await prisma.placeReport.upsert({
          where: { placeId_userId: { placeId: place.id, userId } },
          create: { placeId: place.id, userId, reason: body.reason, comment: body.comment },
          update: { reason: body.reason, comment: body.comment },
        });
        return { ok: true };
      },
    ),
  );

  return r;
}
