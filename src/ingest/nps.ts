// National Park Service ingestion → Place (type "free").
// Source: https://developer.nps.gov/api/v1/parks  (X-Api-Key header)
// Military benefit: free entry for service members & veterans via the
// "America the Beautiful" military/veteran pass.

import { prisma } from "../db.js";
import { env } from "../env.js";
import { getJson, firstNumber } from "./http.js";

const NPS_BASE = "https://developer.nps.gov/api/v1";
const SOURCE = "nps";

interface NpsPark {
  parkCode: string;
  fullName: string;
  designation?: string;
  url?: string;
  latitude?: string;
  longitude?: string;
  states?: string;
  entranceFees?: { cost?: string; title?: string; description?: string }[];
  addresses?: { line1?: string; city?: string; stateCode?: string; postalCode?: string; type?: string }[];
  contacts?: { phoneNumbers?: { phoneNumber?: string; type?: string }[] };
}
interface NpsResponse {
  total: string;
  limit: string;
  start: string;
  data: NpsPark[];
}

export interface IngestResult {
  source: string;
  upserted: number;
  skipped: number;
  removed?: number;
  note?: string;
}

export async function ingestNps(): Promise<IngestResult> {
  if (!env.NPS_API_KEY) {
    return { source: SOURCE, upserted: 0, skipped: 0, note: "NPS_API_KEY not set — skipped" };
  }
  const headers = { "X-Api-Key": env.NPS_API_KEY };
  const limit = 50;
  let start = 0;
  let total = Infinity;
  let upserted = 0;
  let skipped = 0;
  const seen: string[] = [];

  while (start < total) {
    const res = await getJson<NpsResponse>(`${NPS_BASE}/parks?limit=${limit}&start=${start}`, headers);
    // Don't trust `total` blindly — a malformed value would silently stop the
    // run after one page. Keep paging while pages come back full.
    const reportedTotal = Number(res.total);
    total = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : Infinity;
    if (!res.data.length) break;

    for (const p of res.data) {
      const lat = firstNumber(p.latitude);
      const lng = firstNumber(p.longitude);
      if (lat == null || lng == null || (lat === 0 && lng === 0)) {
        skipped++;
        continue;
      }
      const phys = p.addresses?.find((a) => a.type === "Physical") ?? p.addresses?.[0];
      const city = phys?.city ?? null;
      const address = phys
        ? [phys.line1, phys.city, phys.stateCode, phys.postalCode].filter(Boolean).join(", ")
        : null;
      const phone = p.contacts?.phoneNumbers?.find((n) => n.phoneNumber)?.phoneNumber ?? null;
      const fee = p.entranceFees?.[0];
      const summary = fee?.cost
        ? `Standard entrance ~$${fee.cost} — free for service members & veterans with the America the Beautiful military/veteran pass.`
        : "Free entry for service members & veterans (America the Beautiful military/veteran pass).";

      const common = {
        name: p.fullName,
        category: "National Park",
        subcategory: p.designation || null,
        city,
        address,
        lat,
        lng,
        discountSummary: summary,
        website: p.url || null,
        phone,
        lastVerifiedAt: new Date(),
      };

      await prisma.place.upsert({
        where: { externalSource_externalId: { externalSource: SOURCE, externalId: p.parkCode } },
        update: common,
        create: {
          ...common,
          type: "free",
          discountValueType: "free",
          eligibility: ["active_duty", "veteran"],
          proofRequired: true,
          channel: "in_store",
          verificationStatus: "verified",
          status: "active",
          externalSource: SOURCE,
          externalId: p.parkCode,
        },
      });
      seen.push(p.parkCode);
      upserted++;
    }
    if (res.data.length < limit) break;
    start += limit;
  }

  // Sweep rows that vanished upstream. Only runs after a fully successful
  // fetch (any thrown error above aborts first), and never on an empty run.
  let removed = 0;
  if (seen.length > 0) {
    removed = (
      await prisma.place.deleteMany({
        where: { externalSource: SOURCE, externalId: { notIn: seen } },
      })
    ).count;
  }

  const notes = [
    skipped ? `${skipped} skipped (no coordinates)` : null,
    removed ? `${removed} stale rows removed` : null,
  ].filter(Boolean);
  return { source: SOURCE, upserted, skipped, removed, note: notes.length ? notes.join("; ") : undefined };
}
