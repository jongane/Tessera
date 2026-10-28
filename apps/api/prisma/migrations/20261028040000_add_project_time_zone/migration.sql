-- The project's time zone, set by an admin. Used to find the day of a due time.
-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "time_zone" TEXT NOT NULL DEFAULT 'UTC';

