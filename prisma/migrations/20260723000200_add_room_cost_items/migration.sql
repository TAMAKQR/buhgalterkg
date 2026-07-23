CREATE TABLE "room_cost_items" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity_milli" INTEGER NOT NULL DEFAULT 1000,
    "unit_price" INTEGER NOT NULL DEFAULT 0,
    "meal_plan_code" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "room_cost_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "room_cost_items_room_id_sort_order_idx"
ON "room_cost_items"("room_id", "sort_order");

ALTER TABLE "room_cost_items"
ADD CONSTRAINT "room_cost_items_room_id_fkey"
FOREIGN KEY ("room_id") REFERENCES "Room"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
