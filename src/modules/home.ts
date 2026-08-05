import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { centsToDisplay } from "../lib/money.js";
import { radiusBox } from "../lib/geo.js";
import { estimateMonthlyPayCents } from "../data/pay.js";
import { parseBenefits, computeBenefitStates, summarizeBenefits, type BenefitState } from "../lib/cards.js";

function partOfDay(): "morning" | "afternoon" | "evening" {
  const h = new Date().getUTCHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

/**
 * Assemble the full Home dashboard payload. Everything here is server-computed
 * and interconnected: income from the pay engine, TSP snapshot, credit-card
 * credits remaining, benefits expiring soon, nearby places from the user's
 * location, saved-article count, and the latest announcement.
 */
export async function buildHomePayload(userId: string, coords?: { lat: number; lng: number }) {
  const now = new Date();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tsp: true, cards: { include: { product: true, usages: true } } },
  });
  if (!user) throw ApiError.notFound("User not found");

  const lat = coords?.lat ?? user.lat ?? 38.8977;
  const lng = coords?.lng ?? user.lng ?? -77.0365;

  // Income: annual take-home estimate from the pay engine.
  const monthlyIncomeCents = estimateMonthlyPayCents({
    branch: user.branch,
    payGrade: user.payGrade,
    yearsServed: user.yearsServed ?? 0,
    zip: user.zip,
  });
  const annualIncomeCents = monthlyIncomeCents * 12;

  // TSP snapshot value.
  const tspCents = user.tsp?.balanceCents ?? 0;

  // Credit-card credits: remaining value this period + soonest-expiring benefits.
  const expiring: {
    card_id: string;
    card_name: string;
    benefit_id: string;
    benefit_name: string;
    remaining_cents: number;
    remaining_display: string;
    next_reset_at: string | null;
    days_until_reset: number | null;
  }[] = [];
  let cardsRemainingCents = 0;
  for (const card of user.cards) {
    const states: BenefitState[] = computeBenefitStates(
      parseBenefits(card.product.benefits),
      card.usages.map((u) => ({ benefitId: u.benefitId, periodKey: u.periodKey, usedAmountCents: u.usedAmountCents })),
      now,
      card.resetDate,
    );
    cardsRemainingCents += summarizeBenefits(states).remaining_cents;
    for (const s of states) {
      if (s.remaining_cents > 0 && s.days_until_reset != null) {
        expiring.push({
          card_id: card.id,
          card_name: card.product.name,
          benefit_id: s.id,
          benefit_name: s.name,
          remaining_cents: s.remaining_cents,
          remaining_display: centsToDisplay(s.remaining_cents),
          next_reset_at: s.next_reset_at,
          days_until_reset: s.days_until_reset,
        });
      }
    }
  }
  expiring.sort((a, b) => (a.days_until_reset ?? 1e9) - (b.days_until_reset ?? 1e9));
  const cardsCount = user.cards.length;

  const [perksCount, savedArticlesCount, latestAnnouncement] = await Promise.all([
    prisma.place.count({ where: { status: "active" } }),
    prisma.savedArticle.count({ where: { userId } }),
    prisma.announcement.findFirst({
      where: { active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { publishedAt: "desc" },
    }),
  ]);

  // benefits_tracked aggregates the money the app is actively tracking for you.
  const trackedSources = [annualIncomeCents, tspCents, cardsRemainingCents].filter((v) => v > 0);
  const benefitsTrackedCents = trackedSources.reduce((a, b) => a + b, 0);

  // Nearby markers for the map preview.
  const box = radiusBox(lat, lng, 10);
  const nearby = await prisma.place.findMany({
    where: {
      status: "active",
      lat: { gte: box.minLat, lte: box.maxLat },
      lng: { gte: box.minLng, lte: box.maxLng },
    },
    take: 25,
    select: { lat: true, lng: true, type: true },
  });

  const articles = await prisma.article.findMany({ orderBy: { publishedAt: "desc" }, take: 5 });

  return {
    greeting: { part_of_day: partOfDay(), name: user.name ?? "there" },
    benefits_tracked: {
      total_cents: benefitsTrackedCents,
      total_display: centsToDisplay(benefitsTrackedCents),
      across_count: trackedSources.length,
    },
    tiles: {
      cards:
        cardsCount > 0
          ? {
              state: "value",
              value_cents: cardsRemainingCents,
              value_display: centsToDisplay(cardsRemainingCents),
              subtitle: "credits remaining",
              cta: "View cards",
            }
          : { state: "empty", value_display: "---", cta: "Tap to add" },
      income: {
        state: annualIncomeCents > 0 ? "value" : "empty",
        value_cents: annualIncomeCents,
        value_display: centsToDisplay(annualIncomeCents),
      },
      tsp: {
        state: tspCents > 0 ? "value" : "empty",
        value_cents: tspCents,
        value_display: centsToDisplay(tspCents),
      },
      perks: { value_display: `${perksCount.toLocaleString("en-US")}+`, subtitle: "available in this app" },
    },
    recon: {
      title: "Recon your area",
      subtitle: "Discounts and free benefits near you",
      deeplink: "valor://recon",
    },
    map_preview: {
      center: { lat, lng },
      markers: nearby.map((p) => ({ lat: p.lat, lng: p.lng, type: p.type })),
    },
    expiring_benefits: expiring.slice(0, 5),
    saved_articles_count: savedArticlesCount,
    announcement: latestAnnouncement
      ? {
          id: latestAnnouncement.id,
          title: latestAnnouncement.title,
          body: latestAnnouncement.body ?? undefined,
          kind: latestAnnouncement.kind,
          deeplink: latestAnnouncement.deeplink ?? undefined,
          published_at: latestAnnouncement.publishedAt.toISOString(),
        }
      : null,
    action_items: buildActionItems(user, { hasCards: cardsCount > 0, expiringCount: expiring.length }),
    latest_articles: articles.map((a) => ({
      id: a.id,
      emoji: a.emoji ?? "📰",
      title: a.title,
      excerpt: a.excerpt ?? "",
      tag: a.tag ?? "",
      read_minutes: a.readMinutes,
    })),
  };
}

function buildActionItems(
  user: { knowsTsp: boolean; zip: string | null },
  ctx: { hasCards: boolean; expiringCount: number },
) {
  const items: { id: string; icon: string; text: string; deeplink: string }[] = [];
  if (ctx.expiringCount > 0) {
    items.push({
      id: "credits_expiring",
      icon: "creditcard.trianglebadge.exclamationmark",
      text: `You have ${ctx.expiringCount} card credit${ctx.expiringCount > 1 ? "s" : ""} to use before they reset`,
      deeplink: "valor://explore/cards",
    });
  }
  if (!user.knowsTsp) {
    items.push({ id: "add_tsp", icon: "chart.line.uptrend.xyaxis", text: "Add your TSP to track growth", deeplink: "valor://tsp" });
  }
  if (!ctx.hasCards) {
    items.push({ id: "add_card", icon: "creditcard", text: "Add a premium card to track its benefits", deeplink: "valor://explore/cards" });
  }
  if (!user.zip) {
    items.push({ id: "set_location", icon: "location", text: "Set your location for local discounts", deeplink: "valor://settings/location" });
  }
  items.push({ id: "explore_pay", icon: "dollarsign.circle", text: "See your full pay breakdown", deeplink: "valor://explore/pay" });
  return items;
}

export function homeRoutes(): Router {
  const r = Router();
  r.get(
    "/home",
    requireAuth,
    handler(
      { query: z.object({ lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }) },
      async ({ query, userId }) => {
        const coords = query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : undefined;
        return buildHomePayload(userId, coords);
      },
    ),
  );
  return r;
}
