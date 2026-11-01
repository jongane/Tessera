-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "relation_colours" JSONB NOT NULL DEFAULT '{"selected": "DARK", "parent": "BLUE", "subtask": "ORANGE", "deeperSubtask": "ORANGE", "sibling": "GREY"}';

-- The relationship colours must name each of the five relationships once,
-- each with one of the 10 label colours or DARK
-- (docs/card-features.md, section 7). The web app's list is in
-- packages/shared (RELATION_COLOURS); a test keeps the two the same.
CREATE FUNCTION "relation_colours_are_valid"(colours JSONB) RETURNS BOOLEAN
LANGUAGE SQL IMMUTABLE AS $$
  SELECT jsonb_typeof(colours) = 'object'
    AND colours ?& ARRAY['selected', 'parent', 'subtask', 'deeperSubtask', 'sibling']
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_each(colours) AS entry
      WHERE entry.key NOT IN ('selected', 'parent', 'subtask', 'deeperSubtask', 'sibling')
        OR jsonb_typeof(entry.value) <> 'string'
        OR entry.value #>> '{}' NOT IN (
          'GREY', 'RED', 'ORANGE', 'YELLOW', 'GREEN', 'TEAL', 'BLUE',
          'INDIGO', 'PURPLE', 'PINK', 'DARK'
        )
    )
$$;

ALTER TABLE "projects" ADD CONSTRAINT "projects_relation_colours_valid"
  CHECK ("relation_colours_are_valid"("relation_colours"));
