import type { Express } from "express";

import { healthRoutes } from "./modules/health-check.js";
import { authRoutes } from "./modules/auth.js";
import { meRoutes } from "./modules/me.js";
import { onboardingRoutes } from "./modules/onboarding.js";
import { homeRoutes } from "./modules/home.js";
import { placesRoutes } from "./modules/places.js";
import { chainsRoutes } from "./modules/chains.js";
import { favoritesRoutes } from "./modules/favorites.js";
import { uploadsRoutes } from "./modules/uploads.js";
import { payRoutes } from "./modules/calc-pay.js";
import { payProfileRoutes } from "./modules/pay-profile.js";
import { tspRoutes } from "./modules/tsp.js";
import { cardsRoutes } from "./modules/cards.js";
import { remindersRoutes } from "./modules/reminders.js";
import { vaRoutes } from "./modules/va-disability.js";
import { airportsRoutes } from "./modules/airports.js";
import { healthContentRoutes } from "./modules/health-content.js";
import { libraryRoutes } from "./modules/library.js";
import { benefitsRoutes } from "./modules/benefits.js";
import { reconRoutes } from "./modules/recon.js";
import { searchRoutes } from "./modules/search.js";
import { notificationsRoutes } from "./modules/notifications.js";
import { announcementsRoutes } from "./modules/announcements.js";
import { exploreRoutes } from "./modules/explore.js";
import { configRoutes } from "./modules/config.js";

// All feature routers mount under /v1. Each returns an express.Router.
export function registerRoutes(app: Express): void {
  const routers = [
    healthRoutes,
    authRoutes,
    meRoutes,
    onboardingRoutes,
    homeRoutes,
    placesRoutes,
    chainsRoutes,
    favoritesRoutes,
    uploadsRoutes,
    payRoutes,
    payProfileRoutes,
    tspRoutes,
    cardsRoutes,
    remindersRoutes,
    vaRoutes,
    airportsRoutes,
    healthContentRoutes,
    libraryRoutes,
    benefitsRoutes,
    reconRoutes,
    searchRoutes,
    notificationsRoutes,
    announcementsRoutes,
    exploreRoutes,
    configRoutes,
  ];
  for (const make of routers) {
    app.use("/v1", make());
  }
}
