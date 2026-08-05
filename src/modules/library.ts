import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { clampLimit } from "../lib/pagination.js";

type ArticleSummaryFields = {
  id: string;
  emoji: string | null;
  title: string;
  excerpt: string | null;
  tag: string | null;
  category: string | null;
  readMinutes: number;
};

function serializeArticleSummary(a: ArticleSummaryFields, isSaved?: boolean) {
  const summary = {
    id: a.id,
    emoji: a.emoji ?? "📰",
    title: a.title,
    excerpt: a.excerpt ?? "",
    tag: a.tag ?? "",
    category: a.category ?? undefined,
    read_minutes: a.readMinutes,
  };
  if (isSaved === undefined) return summary;
  return { ...summary, is_saved: isSaved };
}

type ArticleDetailFields = ArticleSummaryFields & {
  body: string | null;
  sections: Prisma.JsonValue;
  sources: Prisma.JsonValue;
  trustLabels: Prisma.JsonValue;
  source: string | null;
  lastReviewedAt: Date | null;
  publishedAt: Date;
};

function serializeArticleDetail(a: ArticleDetailFields, isSaved: boolean) {
  return {
    ...serializeArticleSummary(a, isSaved),
    body: a.body ?? "",
    sections: a.sections ?? [],
    sources: a.sources ?? [],
    trust_labels: a.trustLabels ?? [],
    source: a.source ?? undefined,
    last_reviewed_at: a.lastReviewedAt?.toISOString() ?? null,
    published_at: a.publishedAt.toISOString(),
  };
}

export function libraryRoutes(): Router {
  const r = Router();

  r.get(
    "/library/categories",
    requireAuth,
    handler({}, async () => {
      const grouped = await prisma.article.groupBy({ by: ["category"], _count: { _all: true } });
      return {
        data: grouped
          .filter((g) => g.category)
          .map((g) => ({ category: g.category, count: g._count._all })),
      };
    }),
  );

  r.get(
    "/library/articles",
    requireAuth,
    handler(
      {
        query: z.object({
          category: z.string().optional(),
          q: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().optional(),
        }),
      },
      async ({ query, userId }) => {
        const { category, q, cursor } = query;
        const limit = clampLimit(query.limit);
        const where: Prisma.ArticleWhereInput = {};
        if (category) where.category = category;
        if (q) {
          where.OR = [
            { title: { contains: q, mode: "insensitive" } },
            { excerpt: { contains: q, mode: "insensitive" } },
            { tag: { contains: q, mode: "insensitive" } },
          ];
        }
        const cursorId = cursor ? Buffer.from(cursor, "base64url").toString("utf8") : undefined;
        const rows = await prisma.article.findMany({
          where,
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        });
        const hasMore = rows.length > limit;
        const page = hasMore ? rows.slice(0, limit) : rows;
        const savedRows = page.length
          ? await prisma.savedArticle.findMany({
              where: { userId, articleId: { in: page.map((a) => a.id) } },
              select: { articleId: true },
            })
          : [];
        const savedIds = new Set(savedRows.map((s) => s.articleId));
        return {
          data: page.map((a) => serializeArticleSummary(a, savedIds.has(a.id))),
          next_cursor: hasMore
            ? Buffer.from(page[page.length - 1]!.id, "utf8").toString("base64url")
            : null,
        };
      },
    ),
  );

  r.get(
    "/library/articles/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const a = await prisma.article.findUnique({ where: { id: params.id } });
      if (!a) throw ApiError.notFound("Article not found");
      const saved = await prisma.savedArticle.findUnique({
        where: { userId_articleId: { userId, articleId: a.id } },
      });
      return serializeArticleDetail(a, saved !== null);
    }),
  );

  r.put(
    "/library/articles/:id/save",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      const a = await prisma.article.findUnique({ where: { id: params.id } });
      if (!a) throw ApiError.notFound("Article not found");
      await prisma.savedArticle.upsert({
        where: { userId_articleId: { userId, articleId: a.id } },
        create: { userId, articleId: a.id },
        update: {},
      });
      return { is_saved: true, article_id: a.id };
    }),
  );

  r.delete(
    "/library/articles/:id/save",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId }) => {
      await prisma.savedArticle.deleteMany({ where: { userId, articleId: params.id } });
      return { is_saved: false, article_id: params.id };
    }),
  );

  r.get(
    "/library/saved",
    requireAuth,
    handler({}, async ({ userId }) => {
      const saved = await prisma.savedArticle.findMany({
        where: { userId },
        include: { article: true },
        orderBy: { createdAt: "desc" },
      });
      return {
        data: saved.map((s) => ({
          ...serializeArticleSummary(s.article, true),
          saved_at: s.createdAt.toISOString(),
        })),
      };
    }),
  );

  r.get(
    "/library/offline-bundle",
    requireAuth,
    handler({}, async ({ userId }) => {
      const saved = await prisma.savedArticle.findMany({
        where: { userId },
        include: { article: true },
        orderBy: { createdAt: "desc" },
      });
      return {
        generated_at: new Date().toISOString(),
        count: saved.length,
        articles: saved.map((s) => ({
          ...serializeArticleDetail(s.article, true),
          saved_at: s.createdAt.toISOString(),
        })),
      };
    }),
  );

  return r;
}
