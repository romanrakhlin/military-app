import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { radiusBox } from "../lib/geo.js";
import { handler, requireAuth } from "../lib/http.js";

interface Tool {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  deeplink: string;
  badge?: string;
}

// Explore: the app's tool directory with live, location-aware badges.
export function exploreRoutes(): Router {
  const r = Router();

  r.get(
    "/explore",
    requireAuth,
    handler(
      {
        query: z.object({
          lat: z.coerce.number().optional(),
          lng: z.coerce.number().optional(),
        }),
      },
      async ({ query, userId }) => {
        const user = await prisma.user.findUnique({ where: { id: userId } });

        // Prefer query coords, then the user's stored coords.
        const lat = query.lat ?? user?.lat ?? null;
        const lng = query.lng ?? user?.lng ?? null;
        const hasCoords = lat != null && lng != null;

        // Geo pre-filter used for nearby Place counts.
        const geoWhere: Prisma.PlaceWhereInput = {};
        if (hasCoords) {
          const box = radiusBox(lat, lng, 25);
          geoWhere.lat = { gte: box.minLat, lte: box.maxLat };
          geoWhere.lng = { gte: box.minLng, lte: box.maxLng };
        }

        const [
          nearbyDiscounts,
          nearbyFree,
          cardsCount,
          savedArticles,
          tsp,
          payProfile,
          airportsCount,
          stateBenefitsCount,
        ] = await Promise.all([
          prisma.place.count({ where: { status: "active", type: "discount", ...geoWhere } }),
          prisma.place.count({ where: { status: "active", type: "free", ...geoWhere } }),
          prisma.userCard.count({ where: { userId } }),
          prisma.savedArticle.count({ where: { userId } }),
          prisma.tspSnapshot.findUnique({ where: { userId } }),
          prisma.payProfile.findUnique({ where: { userId } }),
          prisma.airport.count(),
          prisma.stateBenefit.count(),
        ]);

        const payConfigured = user?.payGrade != null || payProfile != null;
        const tspBalanceCents = tsp?.balanceCents ?? null;

        const tspBadge =
          tspBalanceCents != null
            ? (tspBalanceCents / 100).toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })
            : "Add";

        const discountsBadge = hasCoords ? `${nearbyDiscounts}` : `${nearbyDiscounts}+`;
        const freeBadge = hasCoords ? `${nearbyFree}` : `${nearbyFree}+`;

        const tools: Tool[] = [
          {
            id: "pay",
            title: "Military Pay",
            subtitle: "Estimate your monthly pay and allowances",
            icon: "dollarsign.circle",
            deeplink: "valor://explore/pay",
            badge: payConfigured ? "Ready" : "Set up",
          },
          {
            id: "tsp",
            title: "TSP",
            subtitle: "Track your Thrift Savings Plan balance",
            icon: "chart.line.uptrend.xyaxis",
            deeplink: "valor://explore/tsp",
            badge: tspBadge,
          },
          {
            id: "cards",
            title: "Credit Cards",
            subtitle: "Military card benefits and fee waivers",
            icon: "creditcard",
            deeplink: "valor://explore/cards",
            badge: cardsCount > 0 ? `${cardsCount}` : "Add",
          },
          {
            id: "discounts",
            title: "Discount Map",
            subtitle: "Military discounts near you",
            icon: "mappin.and.ellipse",
            deeplink: "valor://discover",
            badge: discountsBadge,
          },
          {
            id: "free",
            title: "Free Benefits",
            subtitle: "Free resources and perks nearby",
            icon: "gift",
            deeplink: "valor://discover?type=free",
            badge: freeBadge,
          },
          {
            id: "airports",
            title: "Airports & Lounges",
            subtitle: "Space-A travel and lounge access",
            icon: "airplane",
            deeplink: "valor://explore/airports",
            badge: `${airportsCount}`,
          },
          {
            id: "library",
            title: "Benefits Library",
            subtitle: "Guides and articles on your benefits",
            icon: "books.vertical",
            deeplink: "valor://explore/library",
            badge: savedArticles > 0 ? `${savedArticles} saved` : undefined,
          },
          {
            id: "benefits",
            title: "State Benefits",
            subtitle: "Benefits offered by your state",
            icon: "building.columns",
            deeplink: "valor://explore/benefits",
            badge: `${stateBenefitsCount}`,
          },
        ];

        return { tools, location_known: hasCoords };
      },
    ),
  );

  return r;
}
