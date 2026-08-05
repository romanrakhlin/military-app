// OpenStreetMap ingestion → Brand + Place (type "discount").
// Real US store locations for national chains with verified, corporate-wide,
// everyday military discount programs. Locations come from OSM via the
// Overpass API (© OpenStreetMap contributors, ODbL — attribution required in
// the app). Discount facts are curated here and verified against each brand's
// official program page (see docs/discount-data.md).

import { prisma } from "../db.js";
import { env } from "../env.js";
import type { IngestResult } from "./nps.js";

const SOURCE = "osm";

// Public Overpass instances, tried in order. US-wide brand queries are heavy;
// mirrors rate-limit aggressively, hence failover + retry with backoff.
const OVERPASS_ENDPOINTS = [
  ...(env.OVERPASS_BASE ? [env.OVERPASS_BASE] : []),
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

interface BrandDef {
  wikidata: string;
  name: string;
  category: string;
  blurb: string;
  discountBadge: string;
  summary: string;
  valueType: "percent";
  value: number;
  eligibility: string[];
  channel: "in_store" | "both";
  website: string;
}

// Only corporate-official, everyday (or fixed-schedule) programs. No
// franchise-dependent or seasonal offers.
const BRANDS: BrandDef[] = [
  {
    wikidata: "Q864407",
    name: "The Home Depot",
    category: "Home Improvement",
    blurb: "10% everyday military discount (up to $400/yr) via a verified Home Depot account.",
    discountBadge: "10% off",
    summary: "10% military discount in-store & online (annual cap $400). Verify once in the Home Depot app.",
    valueType: "percent",
    value: 10,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.homedepot.com/c/military-discount-benefit",
  },
  {
    wikidata: "Q1373493",
    name: "Lowe's",
    category: "Home Improvement",
    blurb: "10% everyday military discount, no annual cap, via MyLowe's + ID.me.",
    discountBadge: "10% off",
    summary: "10% everyday military discount in-store & online, no annual cap. Enroll free via MyLowe's Rewards (ID.me).",
    valueType: "percent",
    value: 10,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.lowes.com/l/about/honor-our-military",
  },
  {
    wikidata: "Q6835667",
    name: "Michaels",
    category: "Arts & Crafts",
    blurb: "15% everyday military discount, including sale items.",
    discountBadge: "15% off",
    summary: "15% off entire purchase every day, including sale items. Verify via Michaels Rewards (SheerID) or military ID in store.",
    valueType: "percent",
    value: 15,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.michaels.com",
  },
  {
    wikidata: "Q7071951",
    name: "O'Reilly Auto Parts",
    category: "Auto Parts",
    blurb: "10% in-store military discount with valid military or veteran ID.",
    discountBadge: "10% off",
    summary: "10% military discount in-store with valid military/veteran ID. Some exclusions (oil, sale items, special orders).",
    valueType: "percent",
    value: 10,
    eligibility: ["active_duty", "veteran", "reserves_guard"],
    channel: "in_store",
    website: "https://www.oreillyauto.com/military-discount",
  },
  {
    wikidata: "Q4686051",
    name: "Advance Auto Parts",
    category: "Auto Parts",
    blurb: "10% in-store military discount for service members and veterans.",
    discountBadge: "10% off",
    summary: "10% military discount in-store for active duty, reserve, retired and veterans with valid ID.",
    valueType: "percent",
    value: 10,
    eligibility: ["active_duty", "veteran", "reserves_guard"],
    channel: "in_store",
    website: "https://shop.advanceautoparts.com",
  },
  {
    wikidata: "Q967265",
    name: "Kohl's",
    category: "Department Store",
    blurb: "15% off in-store every Monday for military, veterans & their families.",
    discountBadge: "15% Mondays",
    summary: "15% off qualifying in-store purchases every Monday with military ID (military, veterans & immediate family).",
    valueType: "percent",
    value: 15,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "in_store",
    website: "https://www.kohls.com",
  },
  {
    wikidata: "Q3895",
    name: "Adidas",
    category: "Apparel",
    blurb: "30% military discount online & in-store via ID.me.",
    discountBadge: "30% off",
    summary: "30% military discount online and in participating stores. Verify via ID.me.",
    valueType: "percent",
    value: 30,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.adidas.com",
  },
  {
    wikidata: "Q483915",
    name: "Nike",
    category: "Apparel",
    blurb: "10% military discount online & in Nike stores via SheerID.",
    discountBadge: "10% off",
    summary: "10% military discount online and in Nike-owned stores. Verify via SheerID.",
    valueType: "percent",
    value: 10,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.nike.com",
  },
  {
    wikidata: "Q2031485",
    name: "Under Armour",
    category: "Apparel",
    blurb: "20% military discount online & in-store via ID.me.",
    discountBadge: "20% off",
    summary: "20% military discount online and in Under Armour brand stores. Verify via ID.me.",
    valueType: "percent",
    value: 20,
    eligibility: ["active_duty", "veteran", "reserves_guard", "family"],
    channel: "both",
    website: "https://www.underarmour.com",
  },
];

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}
interface OverpassResponse {
  elements: OverpassElement[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST an Overpass query, failing over across endpoints with backoff. */
async function overpass(query: string): Promise<OverpassResponse> {
  const attempts = OVERPASS_ENDPOINTS.length * 2;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const endpoint = OVERPASS_ENDPOINTS[i % OVERPASS_ENDPOINTS.length]!;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(240_000),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith("{")) {
        throw new Error(`overpass ${endpoint} → ${res.status} ${text.slice(0, 120)}`);
      }
      return JSON.parse(text) as OverpassResponse;
    } catch (err) {
      lastErr = err;
      await sleep(10_000 * (i + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function isClosed(tags: Record<string, string>): boolean {
  return Object.keys(tags).some(
    (k) => k.startsWith("disused:") || k.startsWith("was:") || k.startsWith("closed:") || k.startsWith("abandoned:"),
  );
}

export async function ingestOsmDiscounts(): Promise<IngestResult> {
  let upserted = 0;
  let skipped = 0;
  const seen: string[] = [];

  for (const def of BRANDS) {
    const brandData = {
      name: def.name,
      category: def.category,
      blurb: def.blurb,
      discountBadge: def.discountBadge,
    };
    const existing = await prisma.brand.findFirst({ where: { name: def.name } });
    const brand = existing
      ? await prisma.brand.update({ where: { id: existing.id }, data: brandData })
      : await prisma.brand.create({ data: brandData });

    const res = await overpass(
      `[out:json][timeout:180];area["ISO3166-1"="US"][admin_level=2]->.us;` +
        `nwr["brand:wikidata"="${def.wikidata}"](area.us);out center tags;`,
    );

    for (const el of res.elements) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      const tags = el.tags ?? {};
      if (lat == null || lng == null || isClosed(tags)) {
        skipped++;
        continue;
      }
      const externalId = `${el.type}/${el.id}`;
      const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
      const address =
        [street, tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ") || null;

      const common = {
        name: tags.name ?? def.name,
        brandId: brand.id,
        category: def.category,
        city: tags["addr:city"] ?? null,
        address,
        lat,
        lng,
        discountSummary: def.summary,
        discountValueType: def.valueType,
        discountValue: def.value,
        eligibility: def.eligibility,
        proofRequired: true,
        channel: def.channel,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
        website: def.website,
        lastVerifiedAt: new Date(),
      };
      await prisma.place.upsert({
        where: { externalSource_externalId: { externalSource: SOURCE, externalId } },
        update: common,
        create: {
          ...common,
          type: "discount",
          verificationStatus: "verified",
          status: "active",
          externalSource: SOURCE,
          externalId,
        },
      });
      seen.push(externalId);
      upserted++;
    }
    console.log(`    ${def.name}: ${res.elements.length} locations`);
    await sleep(8_000); // politeness between US-wide queries
  }

  // Sweep OSM rows that vanished upstream. Only after every brand fetched
  // successfully (errors above abort first); never on an empty run.
  let removed = 0;
  if (seen.length > 0) {
    removed = (
      await prisma.place.deleteMany({
        where: { externalSource: SOURCE, externalId: { notIn: seen } },
      })
    ).count;
  }

  const notes = [
    skipped ? `${skipped} skipped (no coords/closed)` : null,
    removed ? `${removed} stale rows removed` : null,
  ].filter(Boolean);
  return { source: SOURCE, upserted, skipped, removed, note: notes.length ? notes.join("; ") : undefined };
}
