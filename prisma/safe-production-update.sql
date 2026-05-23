-- ============================================================
-- Безопасное обновление продакшен-базы (без потери данных)
-- Запускать: psql $DATABASE_URL -f safe-production-update.sql
-- ============================================================

-- 1. Hotel: добавить timezone (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Hotel' AND column_name = 'timezone'
    ) THEN
        ALTER TABLE "Hotel" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Bishkek';
        RAISE NOTICE 'Added Hotel.timezone';
    ELSE
        RAISE NOTICE 'Hotel.timezone already exists — skipped';
    END IF;
END $$;

-- 2. Hotel: добавить currency (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Hotel' AND column_name = 'currency'
    ) THEN
        ALTER TABLE "Hotel" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'KGS';
        RAISE NOTICE 'Added Hotel.currency';
    ELSE
        RAISE NOTICE 'Hotel.currency already exists — skipped';
    END IF;
END $$;

-- 3. HotelAssignment: добавить компенсацию менеджера (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'HotelAssignment' AND column_name = 'revenue_share_pct'
    ) THEN
        ALTER TABLE "HotelAssignment" ADD COLUMN "revenue_share_pct" INTEGER;
        ALTER TABLE "HotelAssignment" ADD COLUMN "shift_pay_amount" INTEGER;
        RAISE NOTICE 'Added HotelAssignment compensation columns';
    ELSE
        RAISE NOTICE 'HotelAssignment compensation columns already exist — skipped';
    END IF;
END $$;

-- 4. Shift: добавить handoverRecipientId (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Shift' AND column_name = 'handoverRecipientId'
    ) THEN
        -- Возможно была старая колонка handover_recipient_id
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'Shift' AND column_name = 'handover_recipient_id'
        ) THEN
            ALTER TABLE "Shift" RENAME COLUMN "handover_recipient_id" TO "handoverRecipientId";
        ELSE
            ALTER TABLE "Shift" ADD COLUMN "handoverRecipientId" TEXT;
        END IF;

        -- FK (безопасно пересоздать)
        ALTER TABLE "Shift" DROP CONSTRAINT IF EXISTS "Shift_handoverRecipientId_fkey";
        ALTER TABLE "Shift" ADD CONSTRAINT "Shift_handoverRecipientId_fkey"
            FOREIGN KEY ("handoverRecipientId") REFERENCES "User"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;

        RAISE NOTICE 'Added Shift.handoverRecipientId';
    ELSE
        RAISE NOTICE 'Shift.handoverRecipientId already exists — skipped';
    END IF;
END $$;

-- 5. Hotel: добавить cleaning_chat_id (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Hotel' AND column_name = 'cleaning_chat_id'
    ) THEN
        ALTER TABLE "Hotel" ADD COLUMN "cleaning_chat_id" TEXT;
        RAISE NOTICE 'Added Hotel.cleaning_chat_id';
    ELSE
        RAISE NOTICE 'Hotel.cleaning_chat_id already exists — skipped';
    END IF;
END $$;

-- 6. Удалить таблицы товаров если вдруг остались (они больше не нужны)
DROP TABLE IF EXISTS "ProductSale" CASCADE;
DROP TABLE IF EXISTS "ProductInventoryEntry" CASCADE;
DROP TABLE IF EXISTS "Product" CASCADE;
DROP TABLE IF EXISTS "ProductCategory" CASCADE;
DROP TYPE IF EXISTS "ProductSaleType";
DROP TYPE IF EXISTS "ProductInventoryAdjustmentType";

-- 7. Hotel: добавить настройки экстранетов (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Hotel' AND column_name = 'uses_extranets'
    ) THEN
        ALTER TABLE "Hotel" ADD COLUMN "uses_extranets" BOOLEAN NOT NULL DEFAULT false;
        RAISE NOTICE 'Added Hotel.uses_extranets';
    ELSE
        RAISE NOTICE 'Hotel.uses_extranets already exists — skipped';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'Hotel' AND column_name = 'extranet_names'
    ) THEN
        ALTER TABLE "Hotel" ADD COLUMN "extranet_names" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
        RAISE NOTICE 'Added Hotel.extranet_names';
    ELSE
        RAISE NOTICE 'Hotel.extranet_names already exists — skipped';
    END IF;
END $$;

-- 8. RoomStay: добавить источник брони и онлайн-оплату (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'RoomStay' AND column_name = 'booking_source'
    ) THEN
        ALTER TABLE "RoomStay" ADD COLUMN "booking_source" TEXT;
        RAISE NOTICE 'Added RoomStay.booking_source';
    ELSE
        RAISE NOTICE 'RoomStay.booking_source already exists — skipped';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'RoomStay' AND column_name = 'online_paid'
    ) THEN
        ALTER TABLE "RoomStay" ADD COLUMN "online_paid" INTEGER NOT NULL DEFAULT 0;
        RAISE NOTICE 'Added RoomStay.online_paid';
    ELSE
        RAISE NOTICE 'RoomStay.online_paid already exists — skipped';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'RoomStay' AND column_name = 'guest_phone'
    ) THEN
        ALTER TABLE "RoomStay" ADD COLUMN "guest_phone" TEXT;
        RAISE NOTICE 'Added RoomStay.guest_phone';
    ELSE
        RAISE NOTICE 'RoomStay.guest_phone already exists — skipped';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'RoomStay' AND column_name = 'company_name'
    ) THEN
        ALTER TABLE "RoomStay" ADD COLUMN "company_name" TEXT;
        RAISE NOTICE 'Added RoomStay.company_name';
    ELSE
        RAISE NOTICE 'RoomStay.company_name already exists — skipped';
    END IF;
END $$;

-- 9. StayTransfer: журнал переселений между комнатами (если нет)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'StayTransfer'
    ) THEN
        CREATE TABLE "StayTransfer" (
            "id" TEXT NOT NULL,
            "stay_id" TEXT NOT NULL,
            "from_room_id" TEXT NOT NULL,
            "to_room_id" TEXT NOT NULL,
            "shift_id" TEXT,
            "note" TEXT,
            "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "StayTransfer_pkey" PRIMARY KEY ("id")
        );

        CREATE INDEX "StayTransfer_stay_id_created_at_idx" ON "StayTransfer"("stay_id", "created_at");
        CREATE INDEX "StayTransfer_from_room_id_created_at_idx" ON "StayTransfer"("from_room_id", "created_at");
        CREATE INDEX "StayTransfer_to_room_id_created_at_idx" ON "StayTransfer"("to_room_id", "created_at");

        ALTER TABLE "StayTransfer"
            ADD CONSTRAINT "StayTransfer_stay_id_fkey" FOREIGN KEY ("stay_id") REFERENCES "RoomStay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

        ALTER TABLE "StayTransfer"
            ADD CONSTRAINT "StayTransfer_from_room_id_fkey" FOREIGN KEY ("from_room_id") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

        ALTER TABLE "StayTransfer"
            ADD CONSTRAINT "StayTransfer_to_room_id_fkey" FOREIGN KEY ("to_room_id") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

        ALTER TABLE "StayTransfer"
            ADD CONSTRAINT "StayTransfer_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

        RAISE NOTICE 'Added StayTransfer table';
    ELSE
        RAISE NOTICE 'StayTransfer table already exists — skipped';
    END IF;
END $$;

-- Готово!
DO $$ BEGIN RAISE NOTICE '✅ Обновление завершено успешно!'; END $$;
