-- Project codes (WEB in WEB-12) and card numbers. See docs/card-features.md, section 1.
-- Written partly by hand: new columns start empty, existing rows are filled
-- in, and only then are the columns made required.

-- AlterTable: new columns, required later
ALTER TABLE "projects" ADD COLUMN "code" VARCHAR(6),
ADD COLUMN "next_card_number" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "cards" ADD COLUMN "project_id" UUID,
ADD COLUMN "number_path" TEXT;

-- CreateTable
CREATE TABLE "project_codes" (
    "code" VARCHAR(6) NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_codes_pkey" PRIMARY KEY ("code")
);

-- Fill in codes for existing projects, oldest first, using the same rule as
-- suggestProjectCode in src/projects/project-code.ts: the initials of the
-- name's words (up to 4); for a one-word name, its first 3 letters; failing
-- that, PRJ. A clash gets a letter added (WEBA, WEBB, ...).
DO $$
DECLARE
    p RECORD;
    base TEXT;
    candidate TEXT;
    attempt INT;
BEGIN
    FOR p IN SELECT "id", "name" FROM "projects" ORDER BY "created_at", "id" LOOP
        base := upper(left(array_to_string(ARRAY(
            SELECT left(word, 1)
            FROM regexp_split_to_table(regexp_replace(p."name", '[^A-Za-z]+', ' ', 'g'), ' ') AS word
            WHERE word <> ''
        ), ''), 4));
        IF length(base) < 2 THEN
            base := upper(left(regexp_replace(p."name", '[^A-Za-z]', '', 'g'), 3));
        END IF;
        IF length(base) < 2 THEN
            base := 'PRJ';
        END IF;

        candidate := base;
        attempt := 0;
        WHILE EXISTS (SELECT 1 FROM "project_codes" WHERE "code" = candidate) LOOP
            IF attempt < 26 THEN
                candidate := left(base, 5) || chr(65 + attempt);
            ELSE
                candidate := left(base, 4) || chr(65 + (attempt / 26) % 26) || chr(65 + attempt % 26);
            END IF;
            attempt := attempt + 1;
        END LOOP;

        UPDATE "projects" SET "code" = candidate WHERE "id" = p."id";
        INSERT INTO "project_codes" ("code", "project_id") VALUES (candidate, p."id");
    END LOOP;
END $$;

-- Number existing cards 1, 2, 3, ... within each project, oldest first.
UPDATE "cards" AS c
SET "project_id" = b."project_id"
FROM "boards" AS b
WHERE b."id" = c."board_id";

UPDATE "cards" AS c
SET "number_path" = numbered.n::TEXT
FROM (
    SELECT "id", row_number() OVER (PARTITION BY "project_id" ORDER BY "created_at", "id") AS n
    FROM "cards"
) AS numbered
WHERE numbered."id" = c."id";

UPDATE "projects" AS p
SET "next_card_number" = counts.total + 1
FROM (SELECT "project_id", count(*) AS total FROM "cards" GROUP BY "project_id") AS counts
WHERE counts."project_id" = p."id";

-- AlterTable: now every row has a value
ALTER TABLE "projects" ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "cards" ALTER COLUMN "project_id" SET NOT NULL,
ALTER COLUMN "number_path" SET NOT NULL;

-- CreateIndex
CREATE INDEX "project_codes_project_id_idx" ON "project_codes"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "boards_id_project_id_key" ON "boards"("id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_project_id_number_path_key" ON "cards"("project_id", "number_path");

-- CreateIndex
CREATE UNIQUE INDEX "projects_code_key" ON "projects"("code");

-- DropForeignKey
ALTER TABLE "cards" DROP CONSTRAINT "cards_board_id_fkey";

-- AddForeignKey
ALTER TABLE "project_codes" ADD CONSTRAINT "project_codes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_project_id_fkey" FOREIGN KEY ("board_id", "project_id") REFERENCES "boards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Written by hand: Prisma cannot describe check constraints.
-- A project code is 2 to 6 capital letters.
ALTER TABLE "projects" ADD CONSTRAINT "projects_code_format" CHECK ("code" ~ '^[A-Z]{2,6}$');
ALTER TABLE "project_codes" ADD CONSTRAINT "project_codes_code_format" CHECK ("code" ~ '^[A-Z]{2,6}$');
-- A card number is whole numbers from 1 up, joined by dots: 12 or 12.1.2.
ALTER TABLE "cards" ADD CONSTRAINT "cards_number_path_format" CHECK ("number_path" ~ '^[1-9][0-9]*(\.[1-9][0-9]*)*$');
