ALTER TABLE "CashEntry" ADD COLUMN "stay_id" TEXT;

CREATE INDEX "CashEntry_stay_id_idx" ON "CashEntry"("stay_id");

ALTER TABLE "CashEntry"
ADD CONSTRAINT "CashEntry_stay_id_fkey"
FOREIGN KEY ("stay_id")
REFERENCES "RoomStay"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
