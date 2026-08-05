import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";

// In-app announcements feed.
export function announcementsRoutes(): Router {
  const r = Router();

  r.get(
    "/announcements",
    requireAuth,
    handler({ query: z.object({}) }, async () => {
      const now = new Date();
      const announcements = await prisma.announcement.findMany({
        where: {
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { publishedAt: "desc" },
      });

      return {
        data: announcements.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body ?? undefined,
          kind: a.kind,
          deeplink: a.deeplink ?? undefined,
          published_at: a.publishedAt.toISOString(),
          expires_at: a.expiresAt?.toISOString() ?? null,
        })),
      };
    }),
  );

  return r;
}
