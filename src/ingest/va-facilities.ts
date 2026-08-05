// VA Lighthouse Facilities API ingestion.
// Source: https://api.va.gov/services/va_facilities/v1/facilities  (apikey header)
// → HealthFacility (health/facilities module) for medical + vet centers,
//   and Place (type "free") so every VA facility shows on the free map.

import { prisma } from "../db.js";
import { env } from "../env.js";
import { getJson, firstNumber } from "./http.js";
import type { IngestResult } from "./nps.js";

const VA_BASE = env.VA_FACILITIES_BASE ?? "https://api.va.gov/services/va_facilities/v1";
const SOURCE = "va_facilities";

interface VaAddressPart {
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  state?: string;
  zip?: string;
}
interface VaFacility {
  id: string;
  attributes?: {
    name?: string;
    facility_type?: string;
    facilityType?: string;
    classification?: string;
    website?: string | null;
    lat?: number;
    long?: number;
    address?: { physical?: VaAddressPart; mailing?: VaAddressPart };
    phone?: { main?: string };
  };
  geometry?: { coordinates?: [number, number] };
  properties?: VaFacility["attributes"];
}
interface VaResponse {
  data?: VaFacility[];
  features?: VaFacility[];
  links?: { next?: string | null };
  meta?: { pagination?: { current_page?: number; total_pages?: number; total_entries?: number } };
}

// facility_type → human category for the free map.
const TYPE_CATEGORY: Record<string, string> = {
  va_health_facility: "VA Medical",
  vet_center: "Vet Center",
  va_benefits_facility: "VA Benefits",
  va_cemetery: "VA Cemetery",
};
const HEALTH_TYPES = new Set(["va_health_facility", "vet_center"]);

export async function ingestVaFacilities(): Promise<IngestResult> {
  if (!env.VA_API_KEY) {
    return { source: SOURCE, upserted: 0, skipped: 0, note: "VA_API_KEY not set — skipped" };
  }
  const headers = { apikey: env.VA_API_KEY };
  const perPage = 100;
  let page = 1;
  let totalPages = Infinity;
  let upserted = 0;
  let skipped = 0;
  const seenPlaces: string[] = [];
  const seenHealth: string[] = [];

  while (page <= totalPages) {
    const res = await getJson<VaResponse>(`${VA_BASE}/facilities?page=${page}&per_page=${perPage}`, headers);
    const rows = res.data ?? res.features ?? [];
    totalPages = res.meta?.pagination?.total_pages ?? (rows.length < perPage ? page : page + 1);
    if (!rows.length) break;

    for (const f of rows) {
      const attr = f.attributes ?? f.properties ?? {};
      const coords = f.geometry?.coordinates;
      const lat = firstNumber(attr.lat, coords?.[1]);
      const lng = firstNumber(attr.long, coords?.[0]);
      if (lat == null || lng == null || (lat === 0 && lng === 0)) {
        skipped++;
        continue;
      }
      // No type → we can't categorize it; skip rather than guess "medical".
      const ftype = attr.facility_type ?? attr.facilityType;
      if (!ftype) {
        skipped++;
        continue;
      }
      const category = TYPE_CATEGORY[ftype] ?? "VA Facility";
      const phys = attr.address?.physical ?? {};
      const address = [phys.address1, phys.address2, phys.address3, phys.city, phys.state, phys.zip]
        .filter(Boolean)
        .join(", ") || null;
      const name = attr.name ?? "VA Facility";
      const phone = attr.phone?.main ?? null;
      const website = attr.website ?? null;

      // Free-map Place for every facility.
      const placeCommon = {
        name,
        category,
        subcategory: attr.classification ?? null,
        city: phys.city ?? null,
        address,
        lat,
        lng,
        discountSummary: `${category} — services for the military & veteran community.`,
        website,
        phone,
        lastVerifiedAt: new Date(),
      };
      await prisma.place.upsert({
        where: { externalSource_externalId: { externalSource: SOURCE, externalId: f.id } },
        update: placeCommon,
        create: {
          ...placeCommon,
          type: "free",
          discountValueType: "free",
          eligibility: ["active_duty", "veteran", "reserves_guard"],
          proofRequired: false,
          channel: "in_store",
          verificationStatus: "verified",
          status: "active",
          externalSource: SOURCE,
          externalId: f.id,
        },
      });

      // Health module facility for medical centers + vet centers.
      if (HEALTH_TYPES.has(ftype)) {
        const hfCommon = {
          name,
          category: attr.classification ?? category,
          address,
          city: phys.city ?? null,
          state: phys.state ?? null,
          lat,
          lng,
          phone,
          website,
        };
        await prisma.healthFacility.upsert({
          where: { externalSource_externalId: { externalSource: SOURCE, externalId: f.id } },
          update: hfCommon,
          create: { ...hfCommon, externalSource: SOURCE, externalId: f.id },
        });
        seenHealth.push(f.id);
      }
      seenPlaces.push(f.id);
      upserted++;
    }
    page += 1;
  }

  // Sweep rows that vanished upstream (e.g. sandbox-only ids after switching
  // to the production API). Only runs after a fully successful fetch — any
  // thrown error above aborts before reaching this — and never on an empty run.
  let removed = 0;
  if (seenPlaces.length > 0) {
    removed = (
      await prisma.place.deleteMany({
        where: { externalSource: SOURCE, externalId: { notIn: seenPlaces } },
      })
    ).count;
    // Same empty-set guard: notIn [] excludes nothing and would wipe the table.
    if (seenHealth.length > 0) {
      removed += (
        await prisma.healthFacility.deleteMany({
          where: { externalSource: SOURCE, externalId: { notIn: seenHealth } },
        })
      ).count;
    }
  }

  const notes = [
    skipped ? `${skipped} skipped (no coordinates or type)` : null,
    removed ? `${removed} stale rows removed` : null,
  ].filter(Boolean);
  return { source: SOURCE, upserted, skipped, removed, note: notes.length ? notes.join("; ") : undefined };
}
