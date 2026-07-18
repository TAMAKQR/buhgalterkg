ALTER TABLE "Hotel"
ADD COLUMN "allow_group_stays" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "allow_online_payments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "show_in_guest_listing" BOOLEAN NOT NULL DEFAULT true;
