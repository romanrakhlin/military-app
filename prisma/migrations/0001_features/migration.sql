-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "sections" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "CardProduct" ADD COLUMN     "loungePrograms" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "waivesFeeForMilitary" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CardBenefitUsage" (
    "id" TEXT NOT NULL,
    "userCardId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "usedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardBenefitUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lounge" (
    "id" TEXT NOT NULL,
    "airportId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terminal" TEXT,
    "type" TEXT NOT NULL DEFAULT 'card',
    "accessPrograms" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,

    CONSTRAINT "Lounge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "married" BOOLEAN NOT NULL DEFAULT false,
    "livesOnBase" BOOLEAN NOT NULL DEFAULT false,
    "specialPays" JSONB NOT NULL DEFAULT '[]',
    "additionalIncomeCents" INTEGER NOT NULL DEFAULT 0,
    "stateOfResidence" TEXT,
    "vaRating" INTEGER,
    "vaMarried" BOOLEAN NOT NULL DEFAULT false,
    "vaChildren" INTEGER NOT NULL DEFAULT 0,
    "vaDependentParents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyBill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedArticle" (
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedArticle_pkey" PRIMARY KEY ("userId","articleId")
);

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'news',
    "deeplink" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardBenefitUsage_userCardId_idx" ON "CardBenefitUsage"("userCardId");

-- CreateIndex
CREATE UNIQUE INDEX "CardBenefitUsage_userCardId_benefitId_periodKey_key" ON "CardBenefitUsage"("userCardId", "benefitId", "periodKey");

-- CreateIndex
CREATE INDEX "Lounge_airportId_idx" ON "Lounge"("airportId");

-- CreateIndex
CREATE UNIQUE INDEX "PayProfile_userId_key" ON "PayProfile"("userId");

-- CreateIndex
CREATE INDEX "MonthlyBill_userId_idx" ON "MonthlyBill"("userId");

-- CreateIndex
CREATE INDEX "SavedArticle_userId_idx" ON "SavedArticle"("userId");

-- CreateIndex
CREATE INDEX "Announcement_active_publishedAt_idx" ON "Announcement"("active", "publishedAt");

-- AddForeignKey
ALTER TABLE "CardBenefitUsage" ADD CONSTRAINT "CardBenefitUsage_userCardId_fkey" FOREIGN KEY ("userCardId") REFERENCES "UserCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lounge" ADD CONSTRAINT "Lounge_airportId_fkey" FOREIGN KEY ("airportId") REFERENCES "Airport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayProfile" ADD CONSTRAINT "PayProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBill" ADD CONSTRAINT "MonthlyBill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedArticle" ADD CONSTRAINT "SavedArticle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedArticle" ADD CONSTRAINT "SavedArticle_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

