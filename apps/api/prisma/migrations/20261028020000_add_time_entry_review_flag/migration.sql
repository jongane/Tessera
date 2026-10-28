-- A timer that ran over 24 hours saves 24 hours, flagged for review. See docs/card-features.md, section 6.
-- AlterTable
ALTER TABLE "time_entries" ADD COLUMN     "needs_review" BOOLEAN NOT NULL DEFAULT false;

