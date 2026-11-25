-- Written by hand: Prisma cannot describe triggers.
-- files_in_chat_project only fires when a file row is written. These two keep
-- a file in its chat's project when what holds it moves instead.

-- A message with files cannot move to a chat of another project.
CREATE FUNCTION "message_files_stay_in_project"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "files" f
      JOIN "chats" c ON c."id" = NEW."chat_id"
      JOIN "boards" b ON b."id" = c."board_id"
      WHERE f."message_id" = NEW."id" AND f."project_id" <> b."project_id"
  ) THEN
    RAISE EXCEPTION 'a message with files cannot move to a chat of another project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "message_files_stay_in_project" BEFORE UPDATE OF "chat_id" ON "messages"
  FOR EACH ROW EXECUTE FUNCTION "message_files_stay_in_project"();

-- A chat holding message files or pending files cannot move to a board of
-- another project.
CREATE FUNCTION "chat_files_stay_in_project"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "boards" b
      WHERE b."id" = NEW."board_id"
        AND EXISTS (
          SELECT 1 FROM "files" f
            WHERE f."project_id" <> b."project_id"
              AND (f."pending_chat_id" = NEW."id"
                OR f."message_id" IN (SELECT m."id" FROM "messages" m WHERE m."chat_id" = NEW."id"))
        )
  ) THEN
    RAISE EXCEPTION 'a chat with files cannot move to a board of another project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "chat_files_stay_in_project" BEFORE UPDATE OF "board_id" ON "chats"
  FOR EACH ROW EXECUTE FUNCTION "chat_files_stay_in_project"();
