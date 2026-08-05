import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { ApiError } from "../lib/errors.js";
import { handler, requireAuth } from "../lib/http.js";
import { centsToDisplay } from "../lib/money.js";
import { buildIcs } from "../lib/ics.js";
import { periodKey } from "../lib/periods.js";
import {
  parseBenefits,
  computeBenefitStates,
  summarizeBenefits,
  type BenefitState,
} from "../lib/cards.js";

// No card numbers are ever accepted or stored — only product references +
// per-period benefit-usage bookkeeping.

type UsageRecord = { benefitId: string; periodKey: string; usedAmountCents: number };

interface CardWithProduct {
  id: string;
  productId: string;
  openedOn: Date | null;
  resetDate: Date | null;
  usages: UsageRecord[];
  product: {
    name: string;
    issuer: string | null;
    annualFeeCents: number;
    benefits: unknown;
    loungePrograms: unknown;
  };
}

function loungePrograms(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

function serializeBenefitState(s: BenefitState) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    amount_cents: s.amountCents,
    period: s.period,
    period_key: s.period_key,
    next_reset_at: s.next_reset_at,
    used_amount_cents: s.used_amount_cents,
    remaining_cents: s.remaining_cents,
    days_until_reset: s.days_until_reset,
  };
}

/** Compute live benefit states for a card at `now`. */
function statesFor(card: CardWithProduct, now: Date): BenefitState[] {
  return computeBenefitStates(
    parseBenefits(card.product.benefits),
    card.usages.map((u) => ({
      benefitId: u.benefitId,
      periodKey: u.periodKey,
      usedAmountCents: u.usedAmountCents,
    })),
    now,
    card.resetDate,
  );
}

function serializeUserCard(card: CardWithProduct, now: Date) {
  const states = statesFor(card, now);
  const summary = summarizeBenefits(states);
  return {
    id: card.id,
    product_id: card.productId,
    name: card.product.name,
    issuer: card.product.issuer ?? undefined,
    annual_fee_cents: card.product.annualFeeCents,
    opened_on: card.openedOn?.toISOString() ?? null,
    reset_date: card.resetDate?.toISOString() ?? null,
    lounge_programs: loungePrograms(card.product.loungePrograms),
    benefits: states.map(serializeBenefitState),
    summary,
    remaining_display: centsToDisplay(summary.remaining_cents),
  };
}

const cardInclude = { product: true, usages: true } as const;

/** Load a single user-owned card (with product + usages) or throw 404. */
async function loadCard(userId: string, id: string): Promise<CardWithProduct> {
  const card = await prisma.userCard.findFirst({
    where: { id, userId },
    include: cardInclude,
  });
  if (!card) throw ApiError.notFound("Card not found");
  return card as unknown as CardWithProduct;
}

export function cardsRoutes(): Router {
  const r = Router();

  // 1. Catalog of all card products.
  r.get(
    "/cards/catalog",
    requireAuth,
    handler({}, async () => {
      const products = await prisma.cardProduct.findMany({ orderBy: { name: "asc" } });
      return {
        data: products.map((p) => {
          const benefits = parseBenefits(p.benefits);
          return {
            id: p.id,
            name: p.name,
            issuer: p.issuer ?? undefined,
            category: p.category ?? undefined,
            annual_fee_cents: p.annualFeeCents,
            waives_fee_for_military: p.waivesFeeForMilitary,
            lounge_programs: loungePrograms(p.loungePrograms),
            blurb: p.blurb ?? undefined,
            benefits: benefits.map((b) => ({
              id: b.id,
              name: b.name,
              description: b.description,
              amount_cents: b.amountCents,
              period: b.period,
            })),
            annual_benefit_value_cents: benefits.reduce((sum, b) => sum + b.amountCents, 0),
          };
        }),
      };
    }),
  );

  // 2. The user's cards with live benefit states + totals.
  r.get(
    "/cards",
    requireAuth,
    handler({}, async ({ userId }) => {
      const now = new Date();
      const cards = await prisma.userCard.findMany({
        where: { userId },
        include: cardInclude,
        orderBy: { createdAt: "desc" },
      });
      const data = cards.map((c) => serializeUserCard(c as unknown as CardWithProduct, now));
      const totals = data.reduce(
        (acc, c) => {
          acc.total_value_cents += c.summary.total_value_cents;
          acc.remaining_cents += c.summary.remaining_cents;
          return acc;
        },
        { total_value_cents: 0, remaining_cents: 0 },
      );
      return {
        data,
        totals: {
          cards: data.length,
          total_value_cents: totals.total_value_cents,
          remaining_cents: totals.remaining_cents,
          remaining_display: centsToDisplay(totals.remaining_cents),
        },
      };
    }),
  );

  // 3. Add a card to the user's wallet.
  r.post(
    "/cards",
    requireAuth,
    handler(
      {
        body: z.object({
          product_id: z.string(),
          opened_on: z.string().datetime().optional(),
          reset_date: z.string().datetime().optional(),
          used_benefits: z.array(z.string()).default([]),
        }),
      },
      async ({ body: b, userId, res }) => {
        const product = await prisma.cardProduct.findUnique({ where: { id: b.product_id } });
        if (!product) throw ApiError.notFound("Card product not found");
        const card = await prisma.userCard.create({
          data: {
            userId,
            productId: b.product_id,
            openedOn: b.opened_on ? new Date(b.opened_on) : undefined,
            resetDate: b.reset_date ? new Date(b.reset_date) : undefined,
            usedBenefits: b.used_benefits,
          },
          include: cardInclude,
        });
        res.status(201).json(serializeUserCard(card as unknown as CardWithProduct, new Date()));
        return undefined;
      },
    ),
  );

  // 4. Remove a card (usages cascade via FK).
  r.delete(
    "/cards/:id",
    requireAuth,
    handler({ params: z.object({ id: z.string() }) }, async ({ params, userId, res }) => {
      const result = await prisma.userCard.deleteMany({ where: { id: params.id, userId } });
      if (result.count === 0) throw ApiError.notFound("Card not found");
      res.status(204).end();
      return undefined;
    }),
  );

  // 5. Mark (part of) a benefit used for the current period.
  r.post(
    "/cards/:id/benefits/:bid/used",
    requireAuth,
    handler(
      {
        params: z.object({ id: z.string(), bid: z.string() }),
        body: z.object({ amount_cents: z.number().int().min(0).optional() }).default({}),
      },
      async ({ params, body, userId }) => {
        const now = new Date();
        const card = await loadCard(userId, params.id);
        const benefit = parseBenefits(card.product.benefits).find((b) => b.id === params.bid);
        if (!benefit) throw ApiError.notFound("Benefit not found");

        const key = periodKey(benefit.period, now);
        const existing = await prisma.cardBenefitUsage.findUnique({
          where: {
            userCardId_benefitId_periodKey: {
              userCardId: card.id,
              benefitId: benefit.id,
              periodKey: key,
            },
          },
        });

        // If amount_cents given, ADD it to the current usage (capped at the face
        // value); if omitted, mark the benefit fully used.
        const prior = existing?.usedAmountCents ?? 0;
        const nextUsed =
          body.amount_cents != null
            ? Math.min(benefit.amountCents, prior + body.amount_cents)
            : benefit.amountCents;

        await prisma.cardBenefitUsage.upsert({
          where: {
            userCardId_benefitId_periodKey: {
              userCardId: card.id,
              benefitId: benefit.id,
              periodKey: key,
            },
          },
          create: {
            userCardId: card.id,
            benefitId: benefit.id,
            periodKey: key,
            usedAmountCents: nextUsed,
          },
          update: { usedAmountCents: nextUsed, usedAt: now },
        });

        const updated = await loadCard(userId, params.id);
        return serializeUserCard(updated, now);
      },
    ),
  );

  // 6. Un-use a benefit for the current period.
  r.delete(
    "/cards/:id/benefits/:bid/used",
    requireAuth,
    handler(
      { params: z.object({ id: z.string(), bid: z.string() }) },
      async ({ params, userId }) => {
        const now = new Date();
        const card = await loadCard(userId, params.id);
        const benefit = parseBenefits(card.product.benefits).find((b) => b.id === params.bid);
        if (!benefit) throw ApiError.notFound("Benefit not found");

        const key = periodKey(benefit.period, now);
        await prisma.cardBenefitUsage.deleteMany({
          where: { userCardId: card.id, benefitId: benefit.id, periodKey: key },
        });

        const updated = await loadCard(userId, params.id);
        return serializeUserCard(updated, now);
      },
    ),
  );

  // 7. Upcoming benefit-reset events as JSON.
  r.get(
    "/cards/calendar",
    requireAuth,
    handler({}, async ({ userId }) => {
      const now = new Date();
      const events = await collectCalendarEvents(userId, now);
      return { data: events };
    }),
  );

  // 8. Same events as an iCalendar file.
  r.get(
    "/cards/calendar.ics",
    requireAuth,
    handler({}, async ({ userId, res }) => {
      const now = new Date();
      const events = await collectCalendarEvents(userId, now);
      const ics = buildIcs(
        events.map((e) => ({
          uid: e.uid,
          title: e.title,
          description: e.description,
          date: new Date(e.date),
        })),
      );
      res.type("text/calendar").send(ics);
      return undefined;
    }),
  );

  return r;
}

interface CalendarEvent {
  uid: string;
  card_id: string;
  card_name: string;
  benefit_id: string;
  benefit_name: string;
  remaining_cents: number;
  date: string;
  title: string;
  description: string;
}

/** Build the upcoming reset events (remaining > 0, has a reset date) sorted asc. */
async function collectCalendarEvents(userId: string, now: Date): Promise<CalendarEvent[]> {
  const cards = await prisma.userCard.findMany({
    where: { userId },
    include: cardInclude,
    orderBy: { createdAt: "desc" },
  });

  const events: CalendarEvent[] = [];
  for (const raw of cards) {
    const card = raw as unknown as CardWithProduct;
    const states = statesFor(card, now);
    for (const s of states) {
      if (s.remaining_cents <= 0 || !s.next_reset_at) continue;
      events.push({
        uid: `${card.id}-${s.id}-${s.period_key}@valor`,
        card_id: card.id,
        card_name: card.product.name,
        benefit_id: s.id,
        benefit_name: s.name,
        remaining_cents: s.remaining_cents,
        date: s.next_reset_at,
        title: `${card.product.name}: ${centsToDisplay(s.remaining_cents)} ${s.name} resets`,
        description: `${centsToDisplay(s.remaining_cents)} of your ${s.name} is still unused and resets on this date.`,
      });
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}
