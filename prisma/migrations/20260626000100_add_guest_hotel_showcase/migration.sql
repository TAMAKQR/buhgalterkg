ALTER TABLE "Hotel"
ADD COLUMN "guest_description" TEXT,
ADD COLUMN "guest_amenities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "guest_photo_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "guest_map_url" TEXT;
