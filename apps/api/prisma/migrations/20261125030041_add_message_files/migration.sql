-- AlterTable
ALTER TABLE "files" ADD COLUMN     "pending_chat_id" UUID;

-- CreateIndex
CREATE INDEX "files_pending_idx" ON "files"("pending_chat_id", "uploader_id", "created_at") WHERE (pending_chat_id IS NOT NULL);

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_pending_chat_id_fkey" FOREIGN KEY ("pending_chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A file belongs to exactly one thing: a card, a message, or (while it is
-- pending, not sent yet) a chat.
ALTER TABLE "files" DROP CONSTRAINT "files_one_owner";
ALTER TABLE "files" ADD CONSTRAINT "files_one_owner" CHECK (
  (("card_id" IS NOT NULL)::int + ("message_id" IS NOT NULL)::int + ("pending_chat_id" IS NOT NULL)::int) = 1
);

-- Written by hand: Prisma cannot describe triggers.
-- Messages have no project_id to build a composite foreign key on, so this
-- trigger keeps a message file and a pending file in the project of their
-- chat's board.
CREATE FUNCTION "files_in_chat_project"() RETURNS trigger AS $$
DECLARE
  chat_project uuid;
BEGIN
  IF NEW."message_id" IS NOT NULL THEN
    SELECT b."project_id" INTO chat_project
      FROM "messages" m
      JOIN "chats" c ON c."id" = m."chat_id"
      JOIN "boards" b ON b."id" = c."board_id"
      WHERE m."id" = NEW."message_id";
  ELSIF NEW."pending_chat_id" IS NOT NULL THEN
    SELECT b."project_id" INTO chat_project
      FROM "chats" c
      JOIN "boards" b ON b."id" = c."board_id"
      WHERE c."id" = NEW."pending_chat_id";
  ELSE
    RETURN NEW;
  END IF;
  IF chat_project IS DISTINCT FROM NEW."project_id" THEN
    RAISE EXCEPTION 'a file must be in the project of its chat'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "files_in_chat_project" BEFORE INSERT OR UPDATE OF "project_id", "message_id", "pending_chat_id" ON "files"
  FOR EACH ROW EXECUTE FUNCTION "files_in_chat_project"();
