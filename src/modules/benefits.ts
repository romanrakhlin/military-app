import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";

// State benefits directory.
export function benefitsRoutes(): Router {
  const r = Router();

  r.get(
    "/benefits",
    requireAuth,
    handler(
      {
        query: z.object({
          state: z.string().optional(),
          status: z.string().optional(),
          category: z.string().optional(),
        }),
      },
      async ({ query }) => {
        const where: Prisma.StateBenefitWhereInput = {};
        if (query.state) where.state = query.state.toUpperCase();
        if (query.status) where.status = query.status;
        if (query.category) where.category = query.category;

        const benefits = await prisma.stateBenefit.findMany({ where, orderBy: [{ state: "asc" }, { title: "asc" }] });
        return {
          data: benefits.map((b) => ({
            id: b.id,
            state: b.state,
            status: b.status ?? undefined,
            category: b.category,
            title: b.title,
            body: b.body ?? undefined,
            source: b.source ?? undefined,
            last_reviewed_at: b.lastReviewedAt?.toISOString() ?? null,
          })),
        };
      },
    ),
  );

  return r;
}
