CREATE TABLE "GuestProfile" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "telegram_id" TEXT,
    "document_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuestProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GuestQrToken" (
    "id" TEXT NOT NULL,
    "guest_profile_id" TEXT NOT NULL,
    "hotel_id" TEXT,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "last_scanned_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestQrToken_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RoomStay" ADD COLUMN "guest_profile_id" TEXT;

CREATE UNIQUE INDEX "GuestQrToken_code_key" ON "GuestQrToken"("code");
CREATE INDEX "GuestProfile_hotel_id_idx" ON "GuestProfile"("hotel_id");
CREATE INDEX "GuestProfile_phone_idx" ON "GuestProfile"("phone");
CREATE INDEX "GuestProfile_telegram_id_idx" ON "GuestProfile"("telegram_id");
CREATE INDEX "GuestQrToken_guest_profile_id_idx" ON "GuestQrToken"("guest_profile_id");
CREATE INDEX "GuestQrToken_hotel_id_idx" ON "GuestQrToken"("hotel_id");
CREATE INDEX "GuestQrToken_code_idx" ON "GuestQrToken"("code");
CREATE INDEX "RoomStay_guest_profile_id_idx" ON "RoomStay"("guest_profile_id");

ALTER TABLE "GuestProfile"
ADD CONSTRAINT "GuestProfile_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GuestQrToken"
ADD CONSTRAINT "GuestQrToken_guest_profile_id_fkey"
FOREIGN KEY ("guest_profile_id") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuestQrToken"
ADD CONSTRAINT "GuestQrToken_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RoomStay"
ADD CONSTRAINT "RoomStay_guest_profile_id_fkey"
FOREIGN KEY ("guest_profile_id") REFERENCES "GuestProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
