CREATE TABLE "StayTransfer" (
    "id" TEXT NOT NULL,
    "stay_id" TEXT NOT NULL,
    "from_room_id" TEXT NOT NULL,
    "to_room_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StayTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StayTransfer_stay_id_created_at_idx" ON "StayTransfer"("stay_id", "created_at");
CREATE INDEX "StayTransfer_from_room_id_created_at_idx" ON "StayTransfer"("from_room_id", "created_at");
CREATE INDEX "StayTransfer_to_room_id_created_at_idx" ON "StayTransfer"("to_room_id", "created_at");

ALTER TABLE "StayTransfer"
ADD CONSTRAINT "StayTransfer_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "RoomStay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StayTransfer"
ADD CONSTRAINT "StayTransfer_from_room_id_fkey" FOREIGN KEY ("from_room_id") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StayTransfer"
ADD CONSTRAINT "StayTransfer_to_room_id_fkey" FOREIGN KEY ("to_room_id") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StayTransfer"
ADD CONSTRAINT "StayTransfer_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
