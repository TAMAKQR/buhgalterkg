ALTER TABLE "CashEntry"
ADD COLUMN "client_operation_id" TEXT;

CREATE UNIQUE INDEX "CashEntry_client_operation_id_key"
ON "CashEntry"("client_operation_id");
