-- The application assumes that a hotel has at most one active cash shift.
-- Keep the invariant even if two processes attempt to open or restore a shift.
CREATE UNIQUE INDEX "Shift_one_open_per_hotel_key"
ON "Shift"("hotelId")
WHERE "status" = 'OPEN';
