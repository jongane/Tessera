-- A conversation is now called a chat (CONTEXT.md, agreed 2026-10-31).
-- Everything is renamed in place, so every row is kept.

ALTER TYPE "thread_kind" RENAME TO "chat_kind";

ALTER TABLE "threads" RENAME TO "chats";

ALTER TABLE "chats" RENAME CONSTRAINT "threads_pkey" TO "chats_pkey";
ALTER TABLE "chats" RENAME CONSTRAINT "threads_board_id_fkey" TO "chats_board_id_fkey";
ALTER TABLE "chats" RENAME CONSTRAINT "threads_card_id_board_id_fkey" TO "chats_card_id_board_id_fkey";
ALTER TABLE "chats" RENAME CONSTRAINT "threads_general_has_no_card" TO "chats_general_has_no_card";

ALTER INDEX "threads_card_id_key" RENAME TO "chats_card_id_key";
ALTER INDEX "threads_board_id_idx" RENAME TO "chats_board_id_idx";
ALTER INDEX "threads_card_id_board_id_key" RENAME TO "chats_card_id_board_id_key";
ALTER INDEX "threads_one_general_per_board" RENAME TO "chats_one_general_per_board";
