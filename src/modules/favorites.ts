import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { serializePlace } from "./_serializers.js";

export function favoritesRoutes(): Router {
  const r = Router();

  r.get(
    "/favorites",
    requireAuth,
    handler(
      { query: z.object({ kind: z.enum(["places"]).default("places") }) },
      async ({ query, userId }) => {
        const favorites = await prisma.favorite.findMany({
          where: { userId },
          include: { place: true },
          orderBy: { createdAt: "desc" },
        });
        const favIds = new Set(favorites.map((f) => f.placeId));
        return {
          kind: query.kind,
          data: favorites
            .filter((f) => f.place.status !== "rejected")
            .map((f) => serializePlace(f.place, { favoriteIds: favIds })),
        };
      },
    ),
  );

  r.put(
    "/favorites/places/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const place = await prisma.place.findUnique({ where: { id: params.id } });
      if (!place) throw ApiError.notFound("Place not found");
      await prisma.favorite.upsert({
        where: { userId_placeId: { userId, placeId: place.id } },
        create: { userId, placeId: place.id },
        update: {},
      });
      return { is_favorite: true, place_id: place.id };
    }),
  );

  r.delete(
    "/favorites/places/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      await prisma.favorite.deleteMany({ where: { userId, placeId: params.id } });
      return { is_favorite: false, place_id: params.id };
    }),
  );

  return r;
}
