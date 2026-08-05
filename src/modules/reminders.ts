import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { handler, requireAuth } from "../lib/http.js";
import { centsToDisplay } from "../lib/money.js";
import { parseBenefits, computeBenefitStates } from "../lib/cards.js";

// Cross-card feed of benefits whose value expires soon. Self-contained: it
// recomputes benefit states from the shared card library rather than depending
// on the cards module.
export function remindersRoutes(): Router {
  const r = Router();

  r.get(
    "/reminders",
    requireAuth,
    handler(
      { query: z.object({ within_days: z.coerce.number().int().min(0).default(45) }) },
      async ({ query, userId }) => {
        const withinDays = query.within_days;
        const now = new Date();

        const cards = await prisma.userCard.findMany({
          where: { userId },
          include: { product: true, usages: true },
          orderBy: { createdAt: "desc" },
        });

        const data = [];
        for (const card of cards) {
          const states = computeBenefitStates(
            parseBenefits(card.product.benefits),
            card.usages.map((u) => ({
              benefitId: u.benefitId,
              periodKey: u.periodKey,
              usedAmountCents: u.usedAmountCents,
            })),
            now,
            card.resetDate,
          );
          for (const s of states) {
            if (s.remaining_cents <= 0) continue;
            if (s.days_until_reset == null || s.days_until_reset > withinDays) continue;
            data.push({
              card_id: card.id,
              card_name: card.product.name,
              benefit_id: s.id,
              benefit_name: s.name,
              remaining_cents: s.remaining_cents,
              remaining_display: centsToDisplay(s.remaining_cents),
              next_reset_at: s.next_reset_at,
              days_until_reset: s.days_until_reset,
              period: s.period,
            });
          }
        }

        data.sort((a, b) => (a.days_until_reset ?? 0) - (b.days_until_reset ?? 0));

        return { count: data.length, within_days: withinDays, data };
      },
    ),
  );

  return r;
}
