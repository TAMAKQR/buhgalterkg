CREATE TABLE "room_activity_periods" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "active_from" TIMESTAMP(3) NOT NULL,
    "active_to" TIMESTAMP(3),

    CONSTRAINT "room_activity_periods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "room_activity_periods_active_window_check"
        CHECK ("active_to" IS NULL OR "active_to" > "active_from")
);

ALTER TABLE "room_activity_periods"
ADD CONSTRAINT "room_activity_periods_room_id_fkey"
FOREIGN KEY ("room_id") REFERENCES "Room"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "room_activity_periods_room_id_active_from_active_to_idx"
ON "room_activity_periods"("room_id", "active_from", "active_to");

-- PostgreSQL partial uniqueness guarantees at most one currently open lifecycle
-- interval for a room, while still allowing any number of historical intervals.
CREATE UNIQUE INDEX "room_activity_periods_one_open_per_room_idx"
ON "room_activity_periods"("room_id")
WHERE "active_to" IS NULL;

-- For legacy inactive rooms updatedAt is only a best-effort archive estimate.
-- Keep the interval valid even if old data has equal or inconsistent timestamps.
INSERT INTO "room_activity_periods" ("id", "room_id", "active_from", "active_to")
SELECT
    'legacy_' || md5("id" || ':' || "createdAt"::text),
    "id",
    "createdAt",
    CASE
        WHEN "isActive" = true THEN NULL
        ELSE GREATEST(
            COALESCE("archived_at", "updatedAt"),
            "createdAt" + INTERVAL '1 millisecond'
        )
    END
FROM "Room";
