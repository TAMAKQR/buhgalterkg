ALTER TABLE "CashEntry"
ADD COLUMN "room_id" TEXT;

CREATE INDEX "CashEntry_room_id_recordedAt_idx"
ON "CashEntry"("room_id", "recordedAt");

ALTER TABLE "CashEntry"
ADD CONSTRAINT "CashEntry_room_id_fkey"
FOREIGN KEY ("room_id") REFERENCES "Room"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
