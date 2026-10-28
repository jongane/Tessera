-- Assignees with an owner, labels, priority, due dates and card creators.
-- See docs/card-features.md, sections 3, 8 and 10.
-- CreateEnum
CREATE TYPE "card_priority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "label_colour" AS ENUM ('GREY', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'BLUE', 'INDIGO', 'PURPLE', 'PINK');

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "created_by_id" UUID,
ADD COLUMN     "due_at" TIMESTAMPTZ(3),
ADD COLUMN     "due_has_time" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priority" "card_priority" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "card_assignees" (
    "card_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_owner" BOOLEAN NOT NULL DEFAULT false,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_assignees_pkey" PRIMARY KEY ("card_id","user_id")
);

-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "colour" "label_colour" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_labels" (
    "card_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "card_labels_pkey" PRIMARY KEY ("card_id","label_id")
);

-- CreateIndex
CREATE INDEX "card_assignees_project_id_user_id_idx" ON "card_assignees"("project_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_assignees_one_owner_per_card" ON "card_assignees"("card_id") WHERE (is_owner);

-- CreateIndex
CREATE UNIQUE INDEX "labels_project_id_name_key" ON "labels"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "labels_id_project_id_key" ON "labels"("id", "project_id");

-- CreateIndex
CREATE INDEX "card_labels_label_id_idx" ON "card_labels"("label_id");

-- CreateIndex
CREATE INDEX "cards_created_by_id_idx" ON "cards"("created_by_id");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_project_id_user_id_fkey" FOREIGN KEY ("project_id", "user_id") REFERENCES "project_members"("project_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_label_id_project_id_fkey" FOREIGN KEY ("label_id", "project_id") REFERENCES "labels"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Written by hand: each card's single assignee becomes its owner in the new
-- list, if they are still a member of the card's project.
INSERT INTO "card_assignees" ("card_id", "project_id", "user_id", "is_owner")
SELECT c."id", c."project_id", c."assignee_id", true
FROM "cards" c
JOIN "project_members" m ON m."project_id" = c."project_id" AND m."user_id" = c."assignee_id"
WHERE c."assignee_id" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "cards" DROP CONSTRAINT "cards_assignee_id_fkey";

-- DropIndex
DROP INDEX "cards_assignee_id_idx";

-- AlterTable
ALTER TABLE "cards" DROP COLUMN "assignee_id";

-- Written by hand: Prisma cannot describe check constraints.
-- A due date without a time is stored as midnight UTC of that day.
ALTER TABLE "cards" ADD CONSTRAINT "cards_due_date_only_at_midnight" CHECK ("due_has_time" OR "due_at" IS NULL OR "due_at" = date_trunc('day', "due_at" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
ALTER TABLE "cards" ADD CONSTRAINT "cards_due_time_needs_date" CHECK (NOT "due_has_time" OR "due_at" IS NOT NULL);
ALTER TABLE "labels" ADD CONSTRAINT "labels_name_not_blank" CHECK (btrim("name") <> '');
