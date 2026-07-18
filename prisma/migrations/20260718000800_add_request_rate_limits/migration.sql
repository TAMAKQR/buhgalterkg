CREATE TABLE "request_rate_limits" (
    "key_hash" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_rate_limits_pkey" PRIMARY KEY ("key_hash")
);

CREATE INDEX "request_rate_limits_expires_at_idx"
ON "request_rate_limits"("expires_at");
