# Valor API

Backend for **Valor** — a native iOS app for the U.S. military community. The app
is a thin client: this API is the source of truth and returns fully-rendered
payloads. Everything is free/unlocked — there is no billing, entitlements, or
gating anywhere.

- **Stack:** Node.js 22 · TypeScript · Express 5 · Prisma · PostgreSQL · Zod · JWT
- **Deploy target:** Railway (Nixpacks + managed Postgres)

## Conventions

- Transport: HTTPS + JSON. All routes are under `/v1`.
- Auth: `Authorization: Bearer <access_token>` on every request (except `/v1/config`
  and `/v1/health`). Sign-in returns `access_token` + `refresh_token`.
- Money: integer **cents** + USD. Server owns display strings (`value_display`).
- Timestamps: ISO-8601 UTC. IDs: opaque strings.
- Lists paginate with `?limit=&cursor=` → `{ data, next_cursor }`.
- Errors: `{ "error": { "code", "message", "field?" } }`.

## Local development

```bash
cp .env.example .env          # fill in DATABASE_URL + JWT secrets
npm install
npm run prisma:migrate:dev    # create the schema (needs a running Postgres)
npm run db:seed               # demo data + demo@valorapp.com / password123
npm run dev                   # http://localhost:8080
```

Need a local Postgres quickly:

```bash
docker run --name valor-pg -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=valor -p 5432:5432 -d postgres:16
```

Smoke test:

```bash
curl localhost:8080/v1/health
curl -X POST localhost:8080/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@valorapp.com","password":"password123"}'
```

## Deploy to Railway

1. Create a project and add the **PostgreSQL** plugin (injects `DATABASE_URL`).
2. Add a service from this repo. Nixpacks + `railway.json` handle build/start.
3. Set service variables: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `PUBLIC_BASE_URL` (your Railway URL), and `CORS_ORIGINS`.
4. Deploy. On boot the start command runs `prisma migrate deploy` then starts the
   server. Healthcheck is `/v1/health`.
5. One-time seed (optional): `railway run npm run db:seed`.

Generate strong secrets: `openssl rand -hex 48`.

## Endpoint map

| Area | Routes |
|------|--------|
| Auth | `POST /v1/auth/register\|login\|refresh\|logout`, `DELETE /v1/auth/account` |
| Profile | `GET /v1/me`, `PATCH /v1/me`, `GET /v1/me/export` |
| Onboarding | `GET /v1/onboarding/nearby-preview\|segment-stat\|qualification-summary`, `POST /v1/onboarding/complete` |
| Home | `GET /v1/home` (enriched: card credits remaining, expiring benefits, saved-article count, latest announcement) |
| Explore | `GET /v1/explore` (tool directory with live, location-aware badges) |
| Discover | `GET /v1/places`, `/v1/places/:id`, `/v1/places/nearest`, `POST /v1/places`, `/v1/places/:id/confirm`, `/v1/places/:id/report` |
| Chains | `GET /v1/chains`, `/v1/chains/:id/locations` |
| Favorites | `GET /v1/favorites`, `PUT\|DELETE /v1/favorites/places/:id` |
| Uploads | `POST /v1/uploads` |
| Pay | `GET /v1/calc/pay/options`, `POST /v1/calc/pay`, `GET /v1/calc/pay/summary` (saved profile + VA + bills) |
| Pay profile | `GET\|PUT /v1/pay/profile`, `GET\|POST /v1/pay/bills`, `DELETE /v1/pay/bills/:id` |
| TSP | `GET\|PUT /v1/tsp`, `POST /v1/calc/tsp/project` |
| Cards | `GET /v1/cards/catalog`, `GET /v1/cards`, `POST /v1/cards`, `DELETE /v1/cards/:id`, `POST\|DELETE /v1/cards/:id/benefits/:bid/used`, `GET /v1/cards/calendar`, `GET /v1/cards/calendar.ics` |
| Reminders | `GET /v1/reminders` (upcoming credit expirations) |
| VA | `POST /v1/calc/va-disability`, `GET /v1/va-disability/tables` |
| Airports | `GET /v1/airports`, `/v1/airports/:id`, `/v1/airports/:id/lounges` (lounge access matched to the user's cards) |
| Health | `GET /v1/health/resources`, `/v1/health/facilities` |
| Library | `GET /v1/library/categories`, `/v1/library/articles`, `/v1/library/articles/:id`, `PUT\|DELETE /v1/library/articles/:id/save`, `GET /v1/library/saved`, `GET /v1/library/offline-bundle` |
| State benefits | `GET /v1/benefits` |
| Recon / Search | `GET /v1/recon`, `GET /v1/search` |
| Announcements | `GET /v1/announcements` |
| Notifications | `POST /v1/notifications/register`, `GET\|PUT /v1/notifications/preferences` |
| Config | `GET /v1/config` |

## Notes & follow-ups

- **Calculators** (pay, TSP, VA) run real server-side math anchored to 2024 rate
  tables (see `src/data/`). Figures are representative estimates and carry
  `data_year` + `source` provenance. Swap in full official tables when ready.
- **Uploads** returns an id + URL but real object storage (S3 / R2 / Railway
  volume) is not yet wired — see the note in `src/modules/uploads.ts`.
- **Geo queries** use a bounding-box pre-filter + in-memory haversine sort. If
  place volume grows large, move to PostGIS.
