# Valor backend — project instructions

## Git author (IMPORTANT — required for Railway auto-deploy)

**All commits in this repo MUST be authored as `rrakhlin@gmail.com`** (name: `Roman Rakhlin`).
Railway auto-deploys are tied to this author — commits from any other email will **not**
trigger a deploy. The repo's local git config is already set to this. Before committing,
always verify:

```bash
git config user.email   # must print: rrakhlin@gmail.com
```

If it prints anything else, run:

```bash
git config user.email "rrakhlin@gmail.com"
git config user.name  "Roman Rakhlin"
```

## Stack & workflow

- Node 22 · TypeScript (ESM/NodeNext) · Express 5 · Prisma + PostgreSQL · Zod · JWT.
- Deploys to **Railway** (Nixpacks). `railway.json` runs `prisma migrate deploy` on boot;
  healthcheck is `/v1/health`. Railway injects `PORT` + `DATABASE_URL`.
- Scripts: `npm run dev` (watch), `npm run build`, `npm start`, `npm run db:seed`,
  `npm run ingest` (official-data adapters: NPS, VA facilities).
- All API routes are under `/v1`. Errors use `{ error: { code, message, field? } }`.
