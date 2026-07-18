DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "GuestProfile"
        WHERE "hotel_id" IS NOT NULL
          AND "telegram_id" IS NOT NULL
        GROUP BY "hotel_id", "telegram_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate GuestProfile hotel/Telegram pairs found. Review and merge them manually before migrate deploy; profiles are never auto-merged to protect PII and audit history.';
    END IF;
END $$;
