ALTER TABLE "hotel_planned_cost_items"
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GENERAL';

UPDATE "hotel_planned_cost_items"
SET "kind" = 'PAYROLL'
WHERE LOWER("name") LIKE '%зарплат%'
   OR LOWER("name") LIKE '%оклад%'
   OR LOWER("name") LIKE '%payroll%';
