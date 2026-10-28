-- Card history for the Activity tab. See docs/card-features.md, section 9.
-- CreateEnum
CREATE TYPE "activity_kind" AS ENUM ('CREATED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'PRIORITY_CHANGED', 'DUE_DATE_CHANGED', 'ESTIMATE_CHANGED', 'MOVED', 'COMPLETED', 'REOPENED', 'ASSIGNEE_ADDED', 'ASSIGNEE_REMOVED', 'OWNER_CHANGED', 'LABEL_ADDED', 'LABEL_REMOVED', 'SUBTASK_ADDED', 'SUBTASK_REMOVED', 'PARENT_CHANGED', 'NUMBER_CHANGED', 'TIME_LOGGED', 'TIME_ENTRY_EDITED', 'TIME_ENTRY_DELETED', 'CHECKLIST_ADDED', 'CHECKLIST_RENAMED', 'CHECKLIST_DELETED', 'CHECKLIST_ITEM_TO_SUBTASK');

-- CreateTable
CREATE TABLE "card_activity" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "actor_id" UUID,
    "kind" "activity_kind" NOT NULL,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sequence" BIGSERIAL NOT NULL,

    CONSTRAINT "card_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_activity_card_id_sequence_idx" ON "card_activity"("card_id", "sequence");

-- CreateIndex
CREATE INDEX "card_activity_actor_id_idx" ON "card_activity"("actor_id");

-- AddForeignKey
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_activity" ADD CONSTRAINT "card_activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Written by hand: Prisma cannot describe triggers.
-- History is never changed. Only two changes come through, both from
-- foreign keys rather than from a person, so they arrive one trigger level
-- down (pg_trigger_depth() is more than 1 here):
-- - deleting the card or its project deletes its history;
-- - deleting a person's account clears actor_id, keeping the line.
CREATE FUNCTION "card_activity_is_append_only"() RETURNS trigger AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF NEW."actor_id" IS NULL
       AND (NEW."id", NEW."card_id", NEW."project_id", NEW."kind", NEW."details", NEW."created_at", NEW."sequence")
           IS NOT DISTINCT FROM (OLD."id", OLD."card_id", OLD."project_id", OLD."kind", OLD."details", OLD."created_at", OLD."sequence") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'card history cannot be changed';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "card_activity_no_update" BEFORE UPDATE ON "card_activity"
  FOR EACH ROW EXECUTE FUNCTION "card_activity_is_append_only"();
CREATE TRIGGER "card_activity_no_delete" BEFORE DELETE ON "card_activity"
  FOR EACH ROW EXECUTE FUNCTION "card_activity_is_append_only"();
