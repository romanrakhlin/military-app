import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth, signAccessToken, tryGetUserId } from "../lib/http.js";
import {
  hashPassword,
  verifyPassword,
  issueRefreshToken,
  rotateRefreshToken,
  revokeAllRefreshTokens,
} from "../lib/auth.js";
import { serializeUser } from "./me.js";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
});

async function issueSession(userId: string) {
  const access_token = signAccessToken(userId);
  const refresh_token = await issueRefreshToken(userId);
  return { access_token, refresh_token, token_type: "bearer" as const };
}

// Much tighter than the global 300 req/min limiter: every guess here costs an
// argon2 hash, and credentials are worth brute-forcing.
const credentialLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: "rate_limited", message: "Too many attempts — try again shortly" } });
  },
});

// Unauthenticated + row-creating, so limited — but looser than credentials:
// legitimate bursts happen behind carrier-grade NAT (many devices, one IP).
const deviceLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: "rate_limited", message: "Too many attempts — try again shortly" } });
  },
});

export function authRoutes(): Router {
  const r = Router();

  // Anonymous device session: look up or create a user keyed by device_id and
  // issue the same token pair as login. Upsert makes concurrent first-launch
  // calls race-safe (both resolve to the same row).
  r.post(
    "/auth/device",
    deviceLimiter,
    handler({ body: z.object({ device_id: z.string().min(1).max(64) }) }, async ({ body }) => {
      const user = await prisma.user.upsert({
        where: { deviceId: body.device_id },
        create: { deviceId: body.device_id },
        update: {},
      });
      const session = await issueSession(user.id);
      return { ...session, user: serializeUser(user) };
    }),
  );

  r.post(
    "/auth/register",
    credentialLimiter,
    handler({ body: credentials }, async ({ body, req, res }) => {
      const email = body.email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw ApiError.conflict("An account with this email already exists", "email");

      // A device-authenticated caller upgrades in place: attach credentials to
      // the anonymous row so onboarding/profile data carries over.
      const callerId = tryGetUserId(req);
      const deviceUser = callerId ? await prisma.user.findUnique({ where: { id: callerId } }) : null;
      const user =
        deviceUser && deviceUser.email == null
          ? await prisma.user.update({
              where: { id: deviceUser.id },
              data: { email, passwordHash: await hashPassword(body.password), name: body.name ?? deviceUser.name },
            })
          : await prisma.user.create({
              data: { email, passwordHash: await hashPassword(body.password), name: body.name },
            });
      const session = await issueSession(user.id);
      res.status(201).json({ ...session, user: serializeUser(user) });
    }),
  );

  r.post(
    "/auth/login",
    credentialLimiter,
    handler({ body: z.object({ email: z.string().email(), password: z.string().max(200) }) }, async ({ body }) => {
      const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (!user || !user.passwordHash) {
        // Burn comparable argon2 time on unknown emails (and password-less
        // device rows) so response timing doesn't reveal account existence.
        await hashPassword(body.password);
        throw ApiError.unauthorized("Invalid email or password");
      }
      if (!(await verifyPassword(user.passwordHash, body.password))) {
        throw ApiError.unauthorized("Invalid email or password");
      }
      const session = await issueSession(user.id);
      return { ...session, user: serializeUser(user) };
    }),
  );

  r.post(
    "/auth/refresh",
    handler({ body: z.object({ refresh_token: z.string().min(1) }) }, async ({ body }) => {
      let userId: string;
      try {
        ({ userId } = await rotateRefreshToken(body.refresh_token));
      } catch {
        throw ApiError.unauthorized("Invalid or expired refresh token");
      }
      return issueSession(userId);
    }),
  );

  r.post(
    "/auth/logout",
    requireAuth,
    handler({}, async ({ userId }) => {
      await revokeAllRefreshTokens(userId);
      return { ok: true };
    }),
  );

  r.delete(
    "/auth/account",
    requireAuth,
    handler({}, async ({ userId, res }) => {
      await prisma.user.delete({ where: { id: userId } });
      res.status(204).end();
    }),
  );

  return r;
}
