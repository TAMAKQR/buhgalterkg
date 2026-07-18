-- Room labels identify a room inside a hotel. Prevent concurrent or repeated
-- room creation from producing ambiguous duplicates.
DROP INDEX IF EXISTS "Room_hotelId_label_idx";
CREATE UNIQUE INDEX "Room_hotelId_label_key" ON "Room"("hotelId", "label");
