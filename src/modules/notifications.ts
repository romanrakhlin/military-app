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
      { body: z.object({ device_token: z.string().min(1), platform: z.string().optional() }) },
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
    handler({ body: z.object({ preferences: z.record(z.boolean()) }) }, async ({ body, userId }) => {
      const merged = { ...DEFAULT_PREFS, ...body.preferences };
      await prisma.user.update({ where: { id: userId }, data: { notifPrefs: merged } });
      return { preferences: merged };
    }),
  );

  return r;
}
