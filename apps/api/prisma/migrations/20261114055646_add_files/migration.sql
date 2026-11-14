-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "activity_kind" ADD VALUE 'FILE_ADDED';
ALTER TYPE "activity_kind" ADD VALUE 'FILE_REMOVED';
ALTER TYPE "activity_kind" ADD VALUE 'FILE_MOVED';

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "card_id" UUID,
    "message_id" UUID,
    "uploader_id" UUID,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_card_id_created_at_idx" ON "files"("card_id", "created_at");

-- CreateIndex
CREATE INDEX "files_message_id_idx" ON "files"("message_id");

-- CreateIndex
CREATE INDEX "files_project_id_idx" ON "files"("project_id");

-- CreateIndex
CREATE INDEX "files_uploader_id_idx" ON "files"("uploader_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A file belongs to exactly one thing: a card or a message.
ALTER TABLE "files" ADD CONSTRAINT "files_one_owner" CHECK (("card_id" IS NULL) <> ("message_id" IS NULL));

-- The name is 1 to 255 characters (not bytes); the size is 0 or more.
ALTER TABLE "files" ADD CONSTRAINT "files_name_length" CHECK (char_length("name") BETWEEN 1 AND 255);
ALTER TABLE "files" ADD CONSTRAINT "files_size_not_negative" CHECK ("size" >= 0);
