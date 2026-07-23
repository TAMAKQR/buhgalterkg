CREATE TABLE "hotel_planned_cost_items" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_amount" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hotel_planned_cost_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hotel_planned_cost_items_hotel_id_sort_order_idx"
ON "hotel_planned_cost_items"("hotel_id", "sort_order");

ALTER TABLE "hotel_planned_cost_items"
ADD CONSTRAINT "hotel_planned_cost_items_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "hotel_planned_cost_items"
    ("id", "hotel_id", "name", "monthly_amount", "sort_order", "created_at", "updated_at")
SELECT
    CONCAT('legacy_payroll_', "id"), "id", 'Зарплаты', "monthly_payroll_cost", 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Hotel" WHERE "monthly_payroll_cost" > 0;

INSERT INTO "hotel_planned_cost_items"
    ("id", "hotel_id", "name", "monthly_amount", "sort_order", "created_at", "updated_at")
SELECT
    CONCAT('legacy_rent_', "id"), "id", 'Аренда', "monthly_rent_cost", 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Hotel" WHERE "monthly_rent_cost" > 0;

INSERT INTO "hotel_planned_cost_items"
    ("id", "hotel_id", "name", "monthly_amount", "sort_order", "created_at", "updated_at")
SELECT
    CONCAT('legacy_utilities_', "id"), "id", 'Коммунальные услуги', "monthly_utilities_cost", 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Hotel" WHERE "monthly_utilities_cost" > 0;

INSERT INTO "hotel_planned_cost_items"
    ("id", "hotel_id", "name", "monthly_amount", "sort_order", "created_at", "updated_at")
SELECT
    CONCAT('legacy_supplies_', "id"), "id", 'Обслуживание и хозтовары', "monthly_supplies_cost", 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Hotel" WHERE "monthly_supplies_cost" > 0;

INSERT INTO "hotel_planned_cost_items"
    ("id", "hotel_id", "name", "monthly_amount", "sort_order", "created_at", "updated_at")
SELECT
    CONCAT('legacy_other_', "id"), "id", 'Прочее', "monthly_other_cost", 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Hotel" WHERE "monthly_other_cost" > 0;
