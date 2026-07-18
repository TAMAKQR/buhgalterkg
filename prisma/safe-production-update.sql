-- DEPRECATED AND INTENTIONALLY DISABLED.
-- The migration history in prisma/migrations is the only supported way to
-- update the database. Run `prisma migrate deploy` during deployment.
--
-- Keep this server-side guard so every PostgreSQL client fails safely, not
-- only psql clients that understand commands such as \quit.
DO $$
BEGIN
    RAISE EXCEPTION 'safe-production-update.sql is disabled; use prisma migrate deploy';
END
$$;
