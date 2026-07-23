CREATE TABLE "room_cost_categories" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "room_cost_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "room_cost_categories_hotel_id_name_key"
ON "room_cost_categories"("hotel_id", "name");

CREATE INDEX "room_cost_categories_hotel_id_idx"
ON "room_cost_categories"("hotel_id");

ALTER TABLE "room_cost_categories"
ADD CONSTRAINT "room_cost_categories_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Room" ADD COLUMN "cost_category_id" TEXT;
CREATE INDEX "Room_cost_category_id_idx" ON "Room"("cost_category_id");
ALTER TABLE "Room"
ADD CONSTRAINT "Room_cost_category_id_fkey"
FOREIGN KEY ("cost_category_id") REFERENCES "room_cost_categories"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "room_cost_items" ALTER COLUMN "room_id" DROP NOT NULL;
ALTER TABLE "room_cost_items" ADD COLUMN "category_id" TEXT;
CREATE INDEX "room_cost_items_category_id_sort_order_idx"
ON "room_cost_items"("category_id", "sort_order");
ALTER TABLE "room_cost_items"
ADD CONSTRAINT "room_cost_items_category_id_fkey"
FOREIGN KEY ("category_id") REFERENCES "room_cost_categories"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
