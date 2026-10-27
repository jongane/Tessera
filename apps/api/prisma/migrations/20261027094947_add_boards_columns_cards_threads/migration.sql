-- CreateEnum
CREATE TYPE "thread_kind" AS ENUM ('GENERAL', 'TOPIC');

-- CreateTable
CREATE TABLE "boards" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "columns" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "column_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "assignee_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "card_id" UUID,
    "kind" "thread_kind" NOT NULL DEFAULT 'TOPIC',
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "boards_project_id_idx" ON "boards"("project_id");

-- CreateIndex
CREATE INDEX "columns_board_id_position_idx" ON "columns"("board_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "columns_id_board_id_key" ON "columns"("id", "board_id");

-- CreateIndex
CREATE INDEX "cards_board_id_idx" ON "cards"("board_id");

-- CreateIndex
CREATE INDEX "cards_column_id_position_idx" ON "cards"("column_id", "position");

-- CreateIndex
CREATE INDEX "cards_assignee_id_idx" ON "cards"("assignee_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_id_board_id_key" ON "cards"("id", "board_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_card_id_key" ON "threads"("card_id");

-- CreateIndex
CREATE INDEX "threads_board_id_idx" ON "threads"("board_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_card_id_board_id_key" ON "threads"("card_id", "board_id");

-- CreateIndex
CREATE UNIQUE INDEX "threads_one_general_per_board" ON "threads"("board_id") WHERE (kind = 'GENERAL');

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "columns" ADD CONSTRAINT "columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_column_id_board_id_fkey" FOREIGN KEY ("column_id", "board_id") REFERENCES "columns"("id", "board_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "threads" ADD CONSTRAINT "threads_card_id_board_id_fkey" FOREIGN KEY ("card_id", "board_id") REFERENCES "cards"("id", "board_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Written by hand: Prisma cannot describe check constraints.
-- A board's general thread is never linked to a card.
ALTER TABLE "threads" ADD CONSTRAINT "threads_general_has_no_card" CHECK ("kind" <> 'GENERAL' OR "card_id" IS NULL);
