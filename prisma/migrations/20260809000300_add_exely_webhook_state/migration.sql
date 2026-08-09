ALTER TABLE "exely_connections"
ADD COLUMN "reservation_continue_token" TEXT,
ADD COLUMN "last_webhook_at" TIMESTAMP(3),
ADD COLUMN "last_webhook_error" TEXT;
