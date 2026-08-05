-- AlterTable
ALTER TABLE "HealthFacility" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "Place" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HealthFacility_externalSource_externalId_key" ON "HealthFacility"("externalSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Place_externalSource_externalId_key" ON "Place"("externalSource", "externalId");

