ALTER TABLE "Room"
ADD COLUMN "archived_at" TIMESTAMP(3);

-- Existing inactive rooms predate this field. Their last update is the safest
-- available approximation of when they stopped participating in operations.
UPDATE "Room"
SET "archived_at" = "updatedAt"
WHERE "isActive" = false;

CREATE INDEX "Room_hotelId_archived_at_idx"
ON "Room"("hotelId", "archived_at");
