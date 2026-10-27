-- Subtasks, completion and old card numbers. See docs/card-features.md, sections 1, 4 and 5.

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "depth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "is_complete" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "next_subtask_number" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "parent_id" UUID;

-- AlterTable
ALTER TABLE "columns" ADD COLUMN     "is_done" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "card_number_aliases" (
    "project_id" UUID NOT NULL,
    "number_path" TEXT NOT NULL,
    "card_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_number_aliases_pkey" PRIMARY KEY ("project_id","number_path")
);

-- CreateIndex
CREATE INDEX "card_number_aliases_card_id_idx" ON "card_number_aliases"("card_id");

-- CreateIndex
CREATE INDEX "cards_parent_id_idx" ON "cards"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_id_project_id_key" ON "cards"("id", "project_id");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_parent_id_project_id_fkey" FOREIGN KEY ("parent_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "card_number_aliases" ADD CONSTRAINT "card_number_aliases_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Written by hand: existing boards were made with a Done column, which now
-- counts as a done column.
UPDATE "columns" SET "is_done" = true WHERE "name" = 'Done';

-- Written by hand: Prisma cannot describe check constraints.
-- Subtasks go at most 5 levels deep: depth 0 (top level) to 4.
ALTER TABLE "cards" ADD CONSTRAINT "cards_depth_range" CHECK ("depth" BETWEEN 0 AND 4);
-- A card has a parent exactly when it is below the top level.
ALTER TABLE "cards" ADD CONSTRAINT "cards_parent_matches_depth" CHECK (("parent_id" IS NULL) = ("depth" = 0));
ALTER TABLE "cards" ADD CONSTRAINT "cards_not_own_parent" CHECK ("parent_id" <> "id");
-- A completion time is recorded exactly when the card is complete.
ALTER TABLE "cards" ADD CONSTRAINT "cards_completed_at_matches" CHECK ("is_complete" = ("completed_at" IS NOT NULL));
-- Old numbers have the same format as card numbers.
ALTER TABLE "card_number_aliases" ADD CONSTRAINT "card_number_aliases_number_path_format" CHECK ("number_path" ~ '^[1-9][0-9]*(\.[1-9][0-9]*)*$');
