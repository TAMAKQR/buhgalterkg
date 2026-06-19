ALTER TABLE "Hotel" ADD COLUMN "allow_postpaid_stays" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RoomStay" ADD COLUMN "tariff_pending" BOOLEAN NOT NULL DEFAULT false;
