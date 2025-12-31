-- Ensure previous constraint is removed if it exists
ALTER TABLE "Shift" DROP CONSTRAINT IF EXISTS "Shift_handover_recipient_id_fkey";
ALTER TABLE "Shift" DROP CONSTRAINT IF EXISTS "Shift_handoverRecipientId_fkey";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'Shift'
          AND column_name = 'handover_recipient_id'
    ) THEN
        EXECUTE 'ALTER TABLE "Shift" RENAME COLUMN "handover_recipient_id" TO "handoverRecipientId"';
    ELSIF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'Shift'
          AND column_name = 'handoverRecipientId'
    ) THEN
        EXECUTE 'ALTER TABLE "Shift" ADD COLUMN "handoverRecipientId" TEXT';
    END IF;
END $$;

ALTER TABLE "Shift" ADD CONSTRAINT "Shift_handoverRecipientId_fkey" FOREIGN KEY ("handoverRecipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
