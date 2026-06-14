ALTER TABLE "RoomStay" ADD COLUMN "group_ref" TEXT;

CREATE INDEX "RoomStay_hotelId_group_ref_idx" ON "RoomStay"("hotelId", "group_ref");
