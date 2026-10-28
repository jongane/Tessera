-- Named checklists and their items. See docs/card-features.md, section 2.
-- CreateTable
CREATE TABLE "checklists" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_items" (
    "id" UUID NOT NULL,
    "checklist_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "checklists_card_id_position_idx" ON "checklists"("card_id", "position");

-- CreateIndex
CREATE INDEX "checklist_items_checklist_id_position_idx" ON "checklist_items"("checklist_id", "position");

-- AddForeignKey
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_card_id_project_id_fkey" FOREIGN KEY ("card_id", "project_id") REFERENCES "cards"("id", "project_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_fkey" FOREIGN KEY ("checklist_id") REFERENCES "checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Written by hand: Prisma cannot describe check constraints.
ALTER TABLE "checklists" ADD CONSTRAINT "checklists_name_length" CHECK (btrim("name") <> '' AND char_length("name") <= 100);
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_text_length" CHECK (btrim("text") <> '' AND char_length("text") <= 500);
