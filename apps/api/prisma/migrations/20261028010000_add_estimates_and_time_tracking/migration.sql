-- Estimates, time entries and running timers. See docs/card-features.md, section 6.
-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "estimate_minutes" INTEGER;

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "running_timers" (
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "work_date" DATE NOT NULL,

    CONSTRAINT "running_timers_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "time_entries_card_id_idx" ON "time_entries"("card_id");

-- CreateIndex
CREATE INDEX "time_entries_user_id_work_date_idx" ON "time_entries"("user_id", "work_date");

-- CreateIndex
CREATE INDEX "time_entries_project_id_idx" ON "time_entries"("project_id");

-- CreateIndex
CREATE INDEX "running_timers_card_id_idx" ON "running_timers"("card_id");

-- CreateIndex
CREATE INDEX "running_timers_project_id_idx" ON "running_timers"("project_id");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "running_timers" ADD CONSTRAINT "running_timers_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Written by hand: Prisma cannot describe check constraints.
ALTER TABLE "cards" ADD CONSTRAINT "cards_estimate_not_negative" CHECK ("estimate_minutes" >= 0);
-- One entry is 1 minute to 24 hours.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_minutes_range" CHECK ("minutes" BETWEEN 1 AND 1440);
-- A timer entry has both a start and a later end; a typed-in entry has neither.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timer_times" CHECK (
  ("started_at" IS NULL AND "ended_at" IS NULL)
  OR ("started_at" IS NOT NULL AND "ended_at" IS NOT NULL AND "ended_at" > "started_at")
);
