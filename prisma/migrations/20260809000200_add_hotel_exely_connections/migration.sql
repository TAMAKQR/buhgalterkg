CREATE TABLE "exely_connections" (
    "id" TEXT NOT NULL,
    "hotel_id" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "property_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_encrypted" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exely_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "exely_connections_hotel_id_key" ON "exely_connections"("hotel_id");

ALTER TABLE "exely_connections"
ADD CONSTRAINT "exely_connections_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
