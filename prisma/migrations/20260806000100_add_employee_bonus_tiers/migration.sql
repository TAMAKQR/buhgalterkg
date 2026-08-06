CREATE TABLE "employee_bonus_tiers" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "bonus" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_bonus_tiers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_bonus_tiers_employee_id_threshold_key"
ON "employee_bonus_tiers"("employee_id", "threshold");

CREATE INDEX "employee_bonus_tiers_employee_id_idx"
ON "employee_bonus_tiers"("employee_id");

ALTER TABLE "employee_bonus_tiers"
ADD CONSTRAINT "employee_bonus_tiers_employee_id_fkey"
FOREIGN KEY ("employee_id") REFERENCES "hotel_employees"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "employee_bonus_tiers" ("id", "employee_id", "threshold", "bonus")
SELECT CONCAT("id", '_legacy_bonus'), "id", "turnover_threshold", GREATEST("high_pay_amount" - "pay_amount", 0)
FROM "hotel_employees"
WHERE "turnover_threshold" IS NOT NULL
  AND "high_pay_amount" IS NOT NULL
  AND "high_pay_amount" > "pay_amount";
