CREATE TABLE "exely_reservation_rooms" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "booking_number" TEXT NOT NULL,
    "room_stay_index" TEXT NOT NULL,
    "booking_status" TEXT NOT NULL,
    "guest_name" TEXT,
    "source" TEXT,
    "room_type_id" TEXT,
    "room_type_name" TEXT,
    "scheduled_check_in" TIMESTAMP(3) NOT NULL,
    "scheduled_check_out" TIMESTAMP(3) NOT NULL,
    "currency_code" TEXT,
    "total_amount" DECIMAL(18,2),
    "prepaid_amount" DECIMAL(18,2),
    "assigned_stay_id" TEXT,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "exely_reservation_rooms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exely_reservation_rooms_assigned_stay_id_key" ON "exely_reservation_rooms"("assigned_stay_id");
CREATE UNIQUE INDEX "exely_reservation_rooms_hotel_id_booking_number_room_stay_index_key" ON "exely_reservation_rooms"("hotel_id", "booking_number", "room_stay_index");
CREATE INDEX "exely_reservation_rooms_hotel_id_booking_status_scheduled_check_in_idx" ON "exely_reservation_rooms"("hotel_id", "booking_status", "scheduled_check_in");
CREATE INDEX "exely_reservation_rooms_hotel_id_assigned_stay_id_idx" ON "exely_reservation_rooms"("hotel_id", "assigned_stay_id");

ALTER TABLE "exely_reservation_rooms" ADD CONSTRAINT "exely_reservation_rooms_hotel_id_fkey" FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "exely_reservation_rooms" ADD CONSTRAINT "exely_reservation_rooms_assigned_stay_id_fkey" FOREIGN KEY ("assigned_stay_id") REFERENCES "RoomStay"("id") ON DELETE SET NULL ON UPDATE CASCADE;
