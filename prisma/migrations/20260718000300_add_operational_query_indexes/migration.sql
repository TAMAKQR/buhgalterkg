CREATE INDEX "RoomStay_roomId_status_scheduledCheckIn_scheduledCheckOut_idx"
ON "RoomStay"("roomId", "status", "scheduledCheckIn", "scheduledCheckOut");

CREATE INDEX "RoomStay_hotelId_status_scheduledCheckIn_idx"
ON "RoomStay"("hotelId", "status", "scheduledCheckIn");

CREATE INDEX "RoomStay_shiftId_idx"
ON "RoomStay"("shiftId");

CREATE INDEX "Shift_hotelId_openedAt_idx"
ON "Shift"("hotelId", "openedAt");

CREATE INDEX "CashEntry_hotelId_recordedAt_idx"
ON "CashEntry"("hotelId", "recordedAt");

CREATE INDEX "CashEntry_shiftId_recordedAt_idx"
ON "CashEntry"("shiftId", "recordedAt");

CREATE INDEX "CashEntry_hotelId_entryType_recordedAt_idx"
ON "CashEntry"("hotelId", "entryType", "recordedAt");
