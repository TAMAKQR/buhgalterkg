CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CashEntry"
ADD COLUMN "expense_category_id" TEXT;

CREATE INDEX "ExpenseCategory_hotelId_idx" ON "ExpenseCategory"("hotelId");

CREATE UNIQUE INDEX "ExpenseCategory_hotelId_name_key" ON "ExpenseCategory"("hotelId", "name");

ALTER TABLE "ExpenseCategory"
ADD CONSTRAINT "ExpenseCategory_hotelId_fkey"
FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CashEntry"
ADD CONSTRAINT "CashEntry_expense_category_id_fkey"
FOREIGN KEY ("expense_category_id") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;