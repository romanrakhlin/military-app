import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth, signAccessToken } from "../lib/http.js";
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

export function authRoutes(): Router {
  const r = Router();

  r.post(
    "/auth/register",
    credentialLimiter,
    handler({ body: credentials }, async ({ body, res }) => {
      const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
      if (existing) throw ApiError.conflict("An account with this email already exists", "email");

      const user = await prisma.user.create({
        data: { email: body.email.toLowerCase(), passwordHash: await hashPassword(body.password), name: body.name },
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
      if (!user) {
        // Burn comparable argon2 time on unknown emails so response timing
        // doesn't reveal whether an account exists.
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
