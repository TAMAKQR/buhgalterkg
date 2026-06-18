ALTER TABLE "Shift"
ADD COLUMN "opening_cash_usd" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "closing_cash_usd" INTEGER,
ADD COLUMN "handover_cash_usd" INTEGER;

ALTER TABLE "CashEntry"
ADD COLUMN "original_amount" INTEGER,
ADD COLUMN "original_currency" TEXT NOT NULL DEFAULT 'KGS',
ADD COLUMN "exchange_rate" INTEGER;

UPDATE "CashEntry"
SET "original_amount" = "amount"
WHERE "original_amount" IS NULL;

UPDATE "CashEntry" AS ce
SET "original_currency" = h."currency"
FROM "Hotel" AS h
WHERE ce."hotelId" = h."id";
