import crypto from "node:crypto";
import argon2 from "argon2";
import { prisma } from "../db.js";
import { env } from "../env.js";

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Issue a new opaque refresh token, persisting only its hash. */
export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt },
  });
  return raw;
}

/** Validate a refresh token, rotate it, and return the userId. Throws on failure. */
export async function rotateRefreshToken(raw: string): Promise<{ userId: string }> {
  const tokenHash = sha256(raw);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) throw new Error("invalid_refresh_token");

  // Replay of an already-rotated token means it leaked (or the legitimate
  // holder lost the race to a thief) — revoke the whole session family.
  if (record.revokedAt) {
    await revokeAllRefreshTokens(record.userId);
    throw new Error("refresh_token_reused");
  }
  if (record.expiresAt < new Date()) throw new Error("invalid_refresh_token");

  // Conditional update makes rotation single-use even under concurrency: only
  // one caller wins the revokedAt: null → set transition.
  const rotated = await prisma.refreshToken.updateMany({
    where: { id: record.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (rotated.count === 0) {
    await revokeAllRefreshTokens(record.userId);
    throw new Error("refresh_token_reused");
  }
  return { userId: record.userId };
}

export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
