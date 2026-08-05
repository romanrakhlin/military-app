import { Router } from "express";
import { handler } from "../lib/http.js";

// Public config — fetched before sign-in, so no auth required.
export function configRoutes(): Router {
  const r = Router();
  r.get(
    "/config",
    handler({}, async () => ({
      min_supported_app_version: "1.0.0",
      feature_flags: {
        community_uploads: true,
        chains_directory: true,
        tsp_projection: true,
        va_calculator: true,
        airports: true,
      },
      disclaimers: {
        non_affiliation:
          "Valor is not affiliated with, endorsed by, or sponsored by the U.S. Department of Defense or any branch of the U.S. Armed Forces.",
        financial:
          "Calculators provide estimates for informational purposes only and are not financial, tax, or legal advice.",
        rates:
          "Pay, TSP, and VA figures are based on published rate tables and may not reflect your exact situation.",
      },
      support_email: "support@valorapp.com",
    })),
  );
  return r;
}
