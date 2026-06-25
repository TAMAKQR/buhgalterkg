CREATE TYPE "GuestVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'NEEDS_REVIEW');

ALTER TABLE "GuestProfile"
ADD COLUMN "verification_status" "GuestVerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "verified_at" TIMESTAMP(3),
ADD COLUMN "verified_by_id" TEXT,
ADD COLUMN "verified_hotel_id" TEXT;

CREATE INDEX "GuestProfile_verification_status_idx" ON "GuestProfile"("verification_status");
CREATE INDEX "GuestProfile_verified_by_id_idx" ON "GuestProfile"("verified_by_id");
CREATE INDEX "GuestProfile_verified_hotel_id_idx" ON "GuestProfile"("verified_hotel_id");

ALTER TABLE "GuestProfile"
ADD CONSTRAINT "GuestProfile_verified_by_id_fkey"
FOREIGN KEY ("verified_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GuestProfile"
ADD CONSTRAINT "GuestProfile_verified_hotel_id_fkey"
FOREIGN KEY ("verified_hotel_id") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
