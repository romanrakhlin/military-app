-- One report per user per place. Dedupe any existing rows first (keep newest),
-- then add the unique index the app's upsert relies on.
DELETE FROM "PlaceReport" a
USING "PlaceReport" b
WHERE a."placeId" = b."placeId"
  AND a."userId" = b."userId"
  AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "PlaceReport_placeId_userId_key" ON "PlaceReport"("placeId", "userId");
