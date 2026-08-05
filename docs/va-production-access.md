# VA Facilities API — production key setup

Status (Aug 5, 2026): our key (`VA_API_KEY`) works on **sandbox only**. Production
(`api.va.gov`) returns 401. Note: for this open-data API the sandbox serves the **real,
complete dataset** (2,592 facilities, verified against known facilities), so app data is
correct in the meantime — the production key is about ToS-compliant production use and
rate limits, not data quality.

## How to apply (takes ~5 minutes)

1. Go to **https://developer.va.gov/production-access** (overview) and open the
   **production access form**: https://developer.va.gov/production-access/production-access-application
2. Select **VA Facilities API** (open-data API — no OAuth, no PII/PHI section; the demo
   step is minimal or waived for open-data APIs).
3. Submit with the answers below. VA reviews in ~1–2 weeks and emails the production key.

## Suggested form answers

| Field | Answer |
|---|---|
| Applicant / contact | Roman Rakhlin — rrakhlin@gmail.com |
| Organization | Valor (independent developer) |
| App name | Valor — Military Benefits & Discounts |
| Platform | iOS (SwiftUI) |
| App description | Valor helps U.S. service members, veterans, and military families discover benefits and free resources they qualify for: nearby VA medical centers, vet centers, benefits offices and cemeteries on a map, plus national parks with free military access, pay/TSP calculators, and benefit reminders. |
| Value to Veterans | Puts every VA facility (with address, phone, website, hours) on a single map alongside other military benefits, increasing awareness and use of VA services. |
| How the API is used | Server-side batch sync: our backend ingests the full facilities list into our database (paged at 100/page ≈ 26 requests per run) and serves it to the app. No client devices call the VA API directly. |
| Expected volume | ~26 requests per sync run, roughly weekly. Well under default rate limits. |
| Sandbox usage | Full ingestion pipeline built and exercised against sandbox (2,592 facilities synced). |
| PII/PHI | None — open facility data only. No Veteran data is sent to or received from the API. |

Prerequisites the form may ask for (also needed for App Store review anyway):
- **Privacy policy URL** and **terms of service URL** (public web pages).
- **Support email** for the app.

## When the key arrives

1. Update the Railway service variable: `railway variables --set VA_API_KEY=<new key>`
   (and the local `.env` if you run ingest locally).
2. **Remove/leave unset `VA_FACILITIES_BASE`** — the code defaults to the production URL
   (`https://api.va.gov/services/va_facilities/v1`); the override is only for sandbox.
3. Run `npm run ingest -- va`. The ingest's mark-and-sweep will automatically remove any
   rows whose IDs don't exist in the production dataset.
4. Sanity-check counts: `Place` rows with `externalSource = 'va_facilities'` should stay
   ≈2,590; spot-check a facility in the app.
