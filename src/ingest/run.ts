// Ingestion runner. Usage:
//   npm run ingest            → run all adapters that have a key configured
//   npm run ingest -- nps     → run only NPS
//   npm run ingest -- va      → run only VA facilities
//
// Adapters are idempotent (upsert by externalSource+externalId), so re-running
// refreshes existing rows instead of duplicating.

import { disconnectDb } from "../db.js";
import { ingestNps, type IngestResult } from "./nps.js";
import { ingestVaFacilities } from "./va-facilities.js";

const ADAPTERS: Record<string, () => Promise<IngestResult>> = {
  nps: ingestNps,
  va: ingestVaFacilities,
};

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const selected = args.length ? args : Object.keys(ADAPTERS);

  const unknown = selected.filter((s) => !ADAPTERS[s]);
  if (unknown.length) {
    console.error(`Unknown adapter(s): ${unknown.join(", ")}. Available: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  console.log(`Ingesting: ${selected.join(", ")}\n`);
  const results: IngestResult[] = [];
  const failed: string[] = [];
  for (const name of selected) {
    const started = Date.now();
    try {
      const result = await ADAPTERS[name]!();
      results.push(result);
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const note = result.note ? ` — ${result.note}` : "";
      console.log(`  ✓ ${result.source}: ${result.upserted} upserted in ${secs}s${note}`);
    } catch (err) {
      failed.push(name);
      console.error(`  ✗ ${name} failed:`, err instanceof Error ? err.message : err);
    }
  }

  const total = results.reduce((sum, r) => sum + r.upserted, 0);
  console.log(`\nDone. ${total} records upserted.`);

  // A failed adapter must fail the run — otherwise cron/CI reports success
  // while the data silently ages.
  if (failed.length) {
    console.error(`Adapters failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  }
}

main()
  .then(() => disconnectDb())
  .catch(async (err) => {
    console.error(err);
    await disconnectDb();
    process.exit(1);
  });
