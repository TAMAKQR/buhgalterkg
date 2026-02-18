-- CreateTable
CREATE TABLE "BonusTier" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL,
    "bonus_pct" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BonusTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BonusTier_hotelId_idx" ON "BonusTier"("hotelId");

-- CreateIndex
CREATE UNIQUE INDEX "BonusTier_hotelId_threshold_key" ON "BonusTier"("hotelId", "threshold");

-- AddForeignKey
ALTER TABLE "BonusTier" ADD CONSTRAINT "BonusTier_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cleanup old enums if they exist
DROP TYPE IF EXISTS "ProductSaleType";
DROP TYPE IF EXISTS "ProductInventoryAdjustmentType";
