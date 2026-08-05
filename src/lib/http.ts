import type { Request, Response, RequestHandler, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { ZodTypeAny, z } from "zod";
import { env } from "../env.js";
import { ApiError } from "./errors.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export interface RouteSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type InferOr<S extends ZodTypeAny | undefined> = S extends ZodTypeAny ? z.infer<S> : undefined;

export interface Ctx<S extends RouteSchemas> {
  body: InferOr<S["body"]>;
  query: InferOr<S["query"]>;
  params: InferOr<S["params"]>;
  userId: string;
  req: Request;
  res: Response;
}

type Handler<S extends RouteSchemas> = (ctx: Ctx<S>) => unknown | Promise<unknown>;

/**
 * Wrap a route: validates body/query/params against Zod schemas (with coercion),
 * calls the handler with fully-typed inputs, and JSON-serializes its return value
 * as 200. Handlers that need another status/no body call `ctx.res` directly and
 * return `undefined`. Thrown errors flow to the central error handler.
 */
export function handler<S extends RouteSchemas>(schemas: S, fn: Handler<S>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = {
        body: (schemas.body ? schemas.body.parse(req.body) : undefined) as InferOr<S["body"]>,
        query: (schemas.query ? schemas.query.parse(req.query) : undefined) as InferOr<S["query"]>,
        params: (schemas.params ? schemas.params.parse(req.params) : undefined) as InferOr<S["params"]>,
        userId: req.userId ?? "",
        req,
        res,
      };
      const result = await fn(ctx);
      if (!res.headersSent && result !== undefined) {
        res.status(200).json(result);
      }
    } catch (err) {
      next(err);
    }
  };
}

/** Auth middleware — verifies the Bearer access token and attaches req.userId. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return next(ApiError.unauthorized("Authentication required"));
  }
  const token = header.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string };
    req.userId = decoded.sub;
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired access token"));
  }
};

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"],
  });
}
