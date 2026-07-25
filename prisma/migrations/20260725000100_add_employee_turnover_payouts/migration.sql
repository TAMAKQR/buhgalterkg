ALTER TABLE "hotel_employees"
ADD COLUMN "turnover_threshold" INTEGER,
ADD COLUMN "high_pay_amount" INTEGER;

ALTER TABLE "CashEntry"
ADD COLUMN "employee_id" TEXT;

ALTER TABLE "CashEntry"
ADD CONSTRAINT "CashEntry_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "hotel_employees"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashEntry_employee_id_recordedAt_idx"
ON "CashEntry"("employee_id", "recordedAt");
