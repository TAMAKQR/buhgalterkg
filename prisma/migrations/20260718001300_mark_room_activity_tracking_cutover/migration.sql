ALTER TABLE "Room"
ADD COLUMN "activity_tracking_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

COMMENT ON COLUMN "Room"."activity_tracking_started_at" IS
'Activity intervals before this timestamp may be reconstructed from legacy createdAt/updatedAt values.';
