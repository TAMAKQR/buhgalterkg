-- Add OBSERVER to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'OBSERVER';

-- Add login credentials columns for observers
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "login_name" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "login_hash" TEXT;

-- Unique index on login_name
CREATE UNIQUE INDEX IF NOT EXISTS "User_login_name_key" ON "User"("login_name");
