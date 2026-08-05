# Discount data — sources & maintenance

## How discount data is built

Two independent layers, combined by `src/ingest/osm.ts` (`npm run ingest -- osm`):

1. **Discount programs** (the facts: percentage, terms, eligibility) are hand-curated in
   the `BRANDS` array in `src/ingest/osm.ts`. Only corporate-official, everyday (or
   fixed-schedule, e.g. Kohl's Mondays) programs are included — no franchise-dependent
   or seasonal offers. Each entry was verified against the brand's official program page.
   **Last verified: 2026-08-05.** Re-verify all entries at least quarterly — programs
   change terms (Home Depot's annual cap, ID.me vs SheerID verification, etc.).

2. **Store locations** come from OpenStreetMap via the Overpass API, matched by each
   brand's `brand:wikidata` tag, US-wide. Re-running the ingest refreshes locations and
   sweeps stores that closed (removed from OSM).

## Current roster (verified 2026-08-05)

| Brand | Discount | Where | Verification |
|---|---|---|---|
| The Home Depot | 10% (cap $400/yr) | in-store & online | Home Depot account |
| Lowe's | 10% everyday, no cap | in-store & online | MyLowe's + ID.me |
| Michaels | 15% everyday incl. sale items | in-store & online | Rewards + SheerID |
| O'Reilly Auto Parts | 10% (exclusions) | in-store | military/veteran ID |
| Advance Auto Parts | 10% | in-store | military/veteran ID |
| Kohl's | 15% Mondays | in-store | military ID |
| Adidas | 30% | in-store & online | ID.me |
| Nike | 10% | Nike stores & online | SheerID |
| Under Armour | 20% | brand stores & online | ID.me |

Deliberately excluded: AutoZone (location-dependent, not corporate-official),
Great Clips (event-based, not everyday), Bass Pro/Cabela's (terms could not be
confirmed against an official source at review time — re-check and add if confirmed).

## OpenStreetMap attribution (required)

Store locations are © OpenStreetMap contributors, licensed under ODbL
(openstreetmap.org/copyright). **The iOS app must show "Store locations
© OpenStreetMap contributors"** wherever OSM-derived locations are displayed
(e.g. map attribution line or About screen).
