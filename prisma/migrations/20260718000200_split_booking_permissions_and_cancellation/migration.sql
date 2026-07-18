ALTER TABLE "HotelAssignment"
ADD COLUMN "can_edit_bookings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "can_cancel_bookings" BOOLEAN NOT NULL DEFAULT false;

UPDATE "HotelAssignment"
SET
    "can_edit_bookings" = "can_edit_stay_payments",
    "can_cancel_bookings" = "can_edit_stay_payments";

CREATE TYPE "CancellationPaymentAction" AS ENUM ('REFUND', 'RETAIN');

ALTER TABLE "RoomStay"
ADD COLUMN "cancellation_payment_action" "CancellationPaymentAction",
ADD COLUMN "cancellation_amount" INTEGER,
ADD COLUMN "cancelled_at" TIMESTAMP(3),
ADD COLUMN "cancelled_by_id" TEXT;
