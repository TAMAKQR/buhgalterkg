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

-- Готово!
DO $$ BEGIN RAISE NOTICE '✅ Обновление завершено успешно!'; END $$;
