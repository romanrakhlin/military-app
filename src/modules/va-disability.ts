import { Router } from "express";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { computeVaDisability, vaTables, VALID_RATINGS } from "../data/va.js";

export function vaRoutes(): Router {
  const r = Router();

  r.post(
    "/calc/va-disability",
    requireAuth,
    handler(
      {
        body: z.object({
          rating: z.number().int(),
          married: z.boolean().default(false),
          children: z.number().int().min(0).max(20).default(0),
          dependent_parents: z.number().int().min(0).max(2).default(0),
          year: z.number().int().optional(),
        }),
      },
      async ({ body: b }) => {
        if (!VALID_RATINGS.includes(b.rating)) {
          throw ApiError.badRequest(`rating must be one of ${VALID_RATINGS.join(", ")}`, "rating");
        }
        return computeVaDisability({
          rating: b.rating,
          married: b.married,
          children: b.children,
          dependentParents: b.dependent_parents,
          year: b.year,
        });
      },
    ),
  );

  r.get(
    "/va-disability/tables",
    requireAuth,
    handler({ query: z.object({ year: z.coerce.number().optional() }) }, async ({ query }) => vaTables(query.year)),
  );

  return r;
}
