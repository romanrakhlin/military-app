import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { haversineMiles, roundMiles } from "../lib/geo.js";

/** Coerce a Json value into a string[] defensively. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

interface UserCardInfo {
  id: string;
  name: string;
  loungePrograms: string[];
}

/** Load the signed-in user's cards + the union of their lounge programs. */
async function loadUserAccess(userId: string): Promise<{ cards: UserCardInfo[]; programs: Set<string> }> {
  const userCards = await prisma.userCard.findMany({ where: { userId }, include: { product: true } });
  const cards: UserCardInfo[] = userCards.map((uc) => ({
    id: uc.id,
    name: uc.product.name,
    loungePrograms: toStringArray(uc.product.loungePrograms),
  }));
  const programs = new Set<string>();
  for (const c of cards) for (const p of c.loungePrograms) programs.add(p);
  return { cards, programs };
}

interface LoungeRow {
  id: string;
  name: string;
  terminal: string | null;
  type: string;
  accessPrograms: unknown;
  notes: string | null;
}

function serializeLounge(lounge: LoungeRow, access: { cards: UserCardInfo[]; programs: Set<string> }) {
  const accessPrograms = toStringArray(lounge.accessPrograms);
  const isMilitary = lounge.type === "uso" || lounge.type === "military";

  const matchedPrograms = accessPrograms.filter((p) => access.programs.has(p));
  const matchedCards = access.cards
    .filter((c) => c.loungePrograms.some((p) => accessPrograms.includes(p)))
    .map((c) => ({ id: c.id, name: c.name }));

  const via = isMilitary ? [lounge.type, ...matchedPrograms] : matchedPrograms;
  const accessible = isMilitary || matchedPrograms.length > 0;

  return {
    id: lounge.id,
    name: lounge.name,
    terminal: lounge.terminal ?? undefined,
    type: lounge.type,
    access_programs: accessPrograms,
    notes: lounge.notes ?? undefined,
    access: {
      accessible,
      via,
      matched_cards: matchedCards,
    },
  };
}

function serializeAirport(a: {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  details: unknown;
  _count?: { lounges: number };
}) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    city: a.city ?? undefined,
    state: a.state ?? undefined,
    lat: a.lat,
    lng: a.lng,
    details: a.details ?? {},
    lounge_count: a._count?.lounges ?? 0,
  };
}

export function airportsRoutes(): Router {
  const r = Router();

  // Search / nearby airports directory.
  r.get(
    "/airports",
    requireAuth,
    handler(
      {
        query: z.object({
          q: z.string().optional(),
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
          limit: z.coerce.number().min(1).max(100).default(25),
        }),
      },
      async ({ query }) => {
        const { q, lat, lng, limit } = query;
        const where: Prisma.AirportWhereInput = {};
        if (q) {
          where.OR = [
            { code: { contains: q.toUpperCase() } },
            { name: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ];
        }
        const distanceSort = lat != null && lng != null;
        const airports = await prisma.airport.findMany({
          where,
          take: distanceSort ? 500 : limit,
          include: { _count: { select: { lounges: true } } },
        });

        if (distanceSort) {
          return {
            data: airports
              .map((a) => ({ a, d: haversineMiles(lat!, lng!, a.lat, a.lng) }))
              .sort((x, y) => x.d - y.d)
              .slice(0, limit)
              .map(({ a, d }) => ({ ...serializeAirport(a), distance_miles: roundMiles(d) })),
          };
        }
        return { data: airports.map(serializeAirport) };
      },
    ),
  );

  // Single airport with its lounges + per-user access matching.
  r.get(
    "/airports/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const include = { lounges: true } as const;
      const airport =
        (await prisma.airport.findUnique({ where: { id: params.id }, include })) ??
        (await prisma.airport.findUnique({ where: { code: params.id.toUpperCase() }, include }));
      if (!airport) throw ApiError.notFound("Airport not found");

      const access = await loadUserAccess(userId);
      return {
        id: airport.id,
        code: airport.code,
        name: airport.name,
        city: airport.city ?? undefined,
        state: airport.state ?? undefined,
        lat: airport.lat,
        lng: airport.lng,
        details: airport.details ?? {},
        lounges: airport.lounges.map((l) => serializeLounge(l, access)),
      };
    }),
  );

  // Standalone lounge list for an airport with per-user access matching.
  r.get(
    "/airports/:id/lounges",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const include = { lounges: true } as const;
      const airport =
        (await prisma.airport.findUnique({ where: { id: params.id }, include })) ??
        (await prisma.airport.findUnique({ where: { code: params.id.toUpperCase() }, include }));
      if (!airport) throw ApiError.notFound("Airport not found");

      const access = await loadUserAccess(userId);
      return { data: airport.lounges.map((l) => serializeLounge(l, access)) };
    }),
  );

  return r;
}
