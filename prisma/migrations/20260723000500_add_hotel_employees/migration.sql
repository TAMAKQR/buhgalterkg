CREATE TABLE "hotel_employees" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "pay_type" TEXT NOT NULL DEFAULT 'MONTHLY',
    "pay_amount" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hired_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "hotel_employees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "hotel_employees_hotel_id_is_active_idx"
ON "hotel_employees"("hotel_id", "is_active");

ALTER TABLE "hotel_employees"
ADD CONSTRAINT "hotel_employees_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
