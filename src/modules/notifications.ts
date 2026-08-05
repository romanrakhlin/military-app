import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";

const DEFAULT_PREFS = {
  new_discounts: true,
  expiring_benefits: true,
  tsp_updates: true,
  community: true,
  product_news: false,
};

export function notificationsRoutes(): Router {
  const r = Router();

  r.post(
    "/notifications/register",
    requireAuth,
    handler(
      { body: z.object({ device_token: z.string().min(1).max(500), platform: z.enum(["ios", "android"]).optional() }) },
      async ({ body, userId }) => {
        await prisma.deviceToken.upsert({
          where: { token: body.device_token },
          create: { userId, token: body.device_token, platform: body.platform ?? "ios" },
          update: { userId, platform: body.platform ?? "ios" },
        });
        return { ok: true };
      },
    ),
  );

  r.get(
    "/notifications/preferences",
    requireAuth,
    handler({}, async ({ userId }) => {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { notifPrefs: true } });
      return { preferences: (user?.notifPrefs as Record<string, boolean> | null) ?? DEFAULT_PREFS };
    }),
  );

  r.put(
    "/notifications/preferences",
    requireAuth,
    handler(
      {
        body: z.object({
          // Only the known preference keys — junk keys would be persisted and
          // echoed back forever.
          preferences: z
            .object({
              new_discounts: z.boolean().optional(),
              expiring_benefits: z.boolean().optional(),
              tsp_updates: z.boolean().optional(),
              community: z.boolean().optional(),
              product_news: z.boolean().optional(),
            })
            .strict(),
        }),
      },
      async ({ body, userId }) => {
      const merged = { ...DEFAULT_PREFS, ...body.preferences };
      await prisma.user.update({ where: { id: userId }, data: { notifPrefs: merged } });
      return { preferences: merged };
    }),
  );

  return r;
}
