-- Written by hand: Prisma cannot describe triggers.
-- A board whose chats hold message files or pending files cannot move to
-- another project (the files would stay in the old one).
CREATE FUNCTION "board_files_stay_in_project"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "files" f
      WHERE f."project_id" <> NEW."project_id"
        AND (
          f."pending_chat_id" IN (SELECT c."id" FROM "chats" c WHERE c."board_id" = NEW."id")
          OR f."message_id" IN (
            SELECT m."id" FROM "messages" m
              JOIN "chats" c ON c."id" = m."chat_id"
              WHERE c."board_id" = NEW."id")
        )
  ) THEN
    RAISE EXCEPTION 'a board with chat files cannot move to another project'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "board_files_stay_in_project" BEFORE UPDATE OF "project_id" ON "boards"
  FOR EACH ROW EXECUTE FUNCTION "board_files_stay_in_project"();
