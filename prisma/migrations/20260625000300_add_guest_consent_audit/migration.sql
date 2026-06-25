CREATE TYPE "GuestProfileActorType" AS ENUM ('GUEST', 'MANAGER', 'ADMIN', 'SYSTEM');
CREATE TYPE "GuestProfileAuditAction" AS ENUM ('PROFILE_CREATED', 'PROFILE_UPDATED', 'DOCUMENT_VERIFIED', 'CONSENT_ACCEPTED');

ALTER TABLE "GuestProfile"
ADD COLUMN "consent_accepted_at" TIMESTAMP(3),
ADD COLUMN "consent_version" TEXT;

CREATE INDEX "GuestProfile_consent_accepted_at_idx" ON "GuestProfile"("consent_accepted_at");

CREATE TABLE "GuestProfileAuditLog" (
    "id" TEXT NOT NULL,
    "guest_profile_id" TEXT NOT NULL,
    "hotel_id" TEXT,
    "actor_user_id" TEXT,
    "actor_type" "GuestProfileActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_label" TEXT,
    "action" "GuestProfileAuditAction" NOT NULL,
    "changed_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestProfileAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuestProfileAuditLog_guest_profile_id_created_at_idx" ON "GuestProfileAuditLog"("guest_profile_id", "created_at");
CREATE INDEX "GuestProfileAuditLog_hotel_id_idx" ON "GuestProfileAuditLog"("hotel_id");
CREATE INDEX "GuestProfileAuditLog_actor_user_id_idx" ON "GuestProfileAuditLog"("actor_user_id");
CREATE INDEX "GuestProfileAuditLog_action_idx" ON "GuestProfileAuditLog"("action");

ALTER TABLE "GuestProfileAuditLog"
ADD CONSTRAINT "GuestProfileAuditLog_guest_profile_id_fkey"
FOREIGN KEY ("guest_profile_id") REFERENCES "GuestProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GuestProfileAuditLog"
ADD CONSTRAINT "GuestProfileAuditLog_hotel_id_fkey"
FOREIGN KEY ("hotel_id") REFERENCES "Hotel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GuestProfileAuditLog"
ADD CONSTRAINT "GuestProfileAuditLog_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
