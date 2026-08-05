import { Router } from "express";
import { prisma } from "../db.js";
import { handler } from "../lib/http.js";

// Liveness/readiness probe used by Railway (healthcheckPath: /v1/health).
export function healthRoutes(): Router {
  const r = Router();
  r.get(
    "/health",
    handler({}, async ({ res }) => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return { status: "ok", db: "up" };
      } catch {
        res.status(503).json({ status: "degraded", db: "down" });
        return undefined;
      }
    }),
  );
  return r;
}
