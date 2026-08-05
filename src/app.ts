import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

import { env, isProd } from "./env.js";
import { ApiError } from "./lib/errors.js";
import { registerRoutes } from "./routes.js";

export function buildApp(): Express {
  const app = express();

  // Railway terminates TLS one proxy hop in front of the app. Trust exactly one
  // hop so req.ip is the real client (and rate limiting can't be spoofed via
  // X-Forwarded-For — `true` would let anyone bypass it).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    pinoHttp({
      level: isProd ? "info" : "debug",
      transport: isProd
        ? undefined
        : { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname,req,res" } },
      autoLogging: { ignore: (req) => req.url === "/v1/health" },
    }),
  );

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.CORS_ORIGINS === "*" ? true : env.CORS_ORIGINS.split(",").map((s) => s.trim()),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 300,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === "/v1/health",
      handler: (_req, res) => {
        res.status(429).json({ error: { code: "rate_limited", message: "Too many requests" } });
      },
    }),
  );

  registerRoutes(app);

  // 404 — no route matched.
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
  });

  // Central error handler → uniform { error: { code, message, field? } } envelope.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    if (err instanceof ApiError) {
      return res
        .status(err.statusCode)
        .json({ error: { code: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) } });
    }

    if (err instanceof ZodError) {
      const first = err.issues[0];
      const field = first?.path?.length ? first.path.join(".") : undefined;
      return res.status(400).json({
        error: { code: "validation_error", message: first?.message ?? "Invalid request", ...(field ? { field } : {}) },
      });
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        const target = (err.meta?.target as string[] | undefined)?.[0];
        return res
          .status(409)
          .json({ error: { code: "conflict", message: "Already exists", ...(target ? { field: target } : {}) } });
      }
      if (err.code === "P2025") {
        return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
      }
    }

    // Malformed JSON body from express.json().
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: { code: "bad_request", message: "Malformed JSON body" } });
    }

    req.log?.error({ err }, "unhandled error");
    return res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
  });

  return app;
}
