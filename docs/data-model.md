# Data model v0.2 (draft)

Status: draft for review. Covers the MVP only, plus the Link table, which is planned ahead and comes after the MVP. Task tables, Gantt charts, milestones and dependencies are not modelled yet.

## Diagram

```mermaid
erDiagram
    USER ||--o{ PROJECT_MEMBER : "is"
    PROJECT ||--o{ PROJECT_MEMBER : "has"
    PROJECT ||--o{ BOARD : "contains"
    PROJECT ||--o| PROJECT_AI_CONFIG : "may have"
    BOARD ||--o{ COLUMN : "has"
    BOARD ||--o{ CARD : "holds"
    COLUMN ||--o{ CARD : "places"
    BOARD ||--o{ CHAT : "has"
    CARD |o--o| CHAT : "linked to"
    CHAT ||--o{ MESSAGE : "contains"
    USER ||--o{ MESSAGE : "writes"
    CARD ||--o{ FILE : "has attached"
    MESSAGE ||--o{ FILE : "has attached"
    CHAT ||--o{ AI_REQUEST : "logged for"

    CHAT {
        uuid id
        uuid board_id
        uuid card_id "nullable, unique"
        string kind "general or topic"
    }
    PROJECT_AI_CONFIG {
        uuid project_id
        bool enabled "default false"
        string provider
        string model
    }
    CARD {
        uuid id
        uuid board_id
        uuid column_id
        string title
        text description "user story"
    }
    LINK {
        uuid id
        string from_type
        uuid from_id
        string to_type
        uuid to_id
    }
```

`LINK` connects cards, chats and messages to each other. Each link has a type from a list the project admin keeps. Links come after the MVP (see [roadmap.md](roadmap.md)). It is drawn on its own because it points at more than one kind of thing.

## Entities

| Entity | Purpose | Key fields |
|---|---|---|
| User | A person with an account | id, display_name, email (stored in lower case), password_hash (scrypt), is_server_admin |
| Session | A signed-in browser | id, token_hash (the browser's token is never stored), user_id, last_used_at, expires_at |
| FailedSignIn | A failed sign-in, so repeated guesses can be slowed down | email, created_at |
| ServerSettings | Settings for the whole server (always one row) | sign_up_open |
| Project | Top-level container | id, name, description |
| ProjectMember | Who belongs to a project and their role | project_id, user_id, role (admin or member) |
| Board | Kanban board and chat space | id, project_id, name |
| Column | A kanban column | id, board_id, name, position |
| Card | Task or user story | id, board_id, column_id, title, description, position (more fields planned: see below) |
| Chat | A conversation on a board | id, board_id, card_id (optional), kind |
| Message | One chat message (built; the body is Markdown) | id, chat_id, author_id (empty once that account is deleted), body, created_at, edited_at (empty until edited), deleted_at and deleted_by_id (both empty until deleted; deleted_by_id also empties if the deleter's account is deleted) |
| File | An uploaded file's details (built for files on cards; the bytes are in the file store, see "Files" below) | id, project_id, card_id or message_id (exactly one; message_id is not used until files on messages are built), uploader_id (empty once that account is deleted), name, size (bytes), mime_type (the type the API detected, see below), storage_key (unique), created_at |
| Link | Connection between cards, chats and messages, with a type the person picks from a list the project admin keeps (agreed 2026-10-31; not built yet, comes after the MVP, see [roadmap.md](roadmap.md)) | from_type, from_id, to_type, to_id, link type |
| ProjectAiConfig | Whether AI is on for a project, and which provider it uses | project_id, enabled, enabled_by, enabled_at, provider, model, encrypted_api_key |
| AiRequest | Audit log of AI use | id, chat_id, user_id, kind, provider, created_at |

## Rules the database must enforce

1. A card has at most one chat: `Chat.card_id` is unique and optional.
2. Each board has exactly one chat with kind `general`, and it has no card.
3. `ProjectAiConfig.enabled` defaults to false. No AI request is allowed for a project where it is false, and only a member with the admin role can change it.
4. A file is attached to exactly one thing: a card or a message. Built and tested (`files_one_owner`, see "Files" below).
5. Deleting a message marks it deleted (`deleted_at`, and `deleted_by_id` for who did it); it is not erased and its text is kept, because the web app shows a deleted message crossed out for everyone to read (agreed 2026-11-09). A delete is final: the message cannot be edited or deleted again (the API refuses both).
6. All IDs are UUIDs, so they do not reveal how many records exist.
7. A card's column, and a chat's card, are on the same board as the card or chat (composite foreign keys).
8. A column that still has cards cannot be deleted. A card that still has a chat cannot be deleted directly; deleting a card through the API unlinks its chat first, so the chat is kept.
9. Deleting a project deletes its boards; deleting a board deletes its columns, cards and chats, and a chat's messages go with the chat (agreed 2026-11-09).
10. `deleted_by_id` needs `deleted_at`: a message cannot name who deleted it without saying when. The reverse is allowed, because the deleter's account may be deleted later, which empties `deleted_by_id` and keeps `deleted_at` (agreed 2026-11-09).
11. Deleting an account keeps its messages: `author_id` (and `deleted_by_id`, where it names that account) is set to null (agreed 2026-11-09). The web app shows such an author, and such a deleter, as "Former member" (agreed 2026-11-10).
12. A message's `id` may be chosen by the sender (a UUID), so that sending the same message again never saves it twice. See "Messages" in [api.md](api.md) (agreed 2026-11-10).
13. A chat's messages are listed in the order (`created_at`, `id`), so two messages with the same time keep a fixed order. An index on (`chat_id`, `created_at`, `id`) keeps loading a page of messages fast.

Rules 1, 2 (the "at most one general chat" part) and 7 to 9 (the board part) are in place and tested in `apps/api/src/boards/board-rules.db-spec.ts`. "Exactly one" general chat is the job of `BoardsService.createBoard`, which creates it with the board.

The messages table and rules 5 and 9 to 11 are tested in `apps/api/src/chats/messages.db-spec.ts`. Keeping the order of two messages with the same time is tested through the API, in `apps/api/test/messages.e2e-spec.ts`.

Accounts and sessions are tested in `apps/api/src/auth/sign-in-rules.db-spec.ts`: email addresses are stored in lower case, a session token hash is never stored twice, an account's sessions end when it is deleted, and there is exactly one row of server settings. How sign-in works is described in [api.md](api.md).

### Files

The File table (migration `add_files`) holds a file's details. Its bytes are in the file store (SeaweedFS, through the S3 API; [ADR 0003](adr/0003-files-in-seaweedfs-through-the-s3-api.md)), under the key in `storage_key`, which is `files/<random uuid>` and never made from the name. Rules, tested in `apps/api/src/files/file-rules.db-spec.ts`:

- A file belongs to exactly one thing: a row with both `card_id` and `message_id`, or with neither, is refused (rule 4).
- A card file is in its card's project: a composite foreign key on (`card_id`, `project_id`), as for checklists and time entries.
- `name` is 1 to 255 characters (not bytes), `size` is 0 or more, and `storage_key` is unique.
- `mime_type` keeps its name but holds the type the API **detected** from the file's first bytes, never the browser's claim: one of `image/png`, `image/jpeg`, `image/gif` or `image/webp`, or `application/octet-stream` for everything else. Only the four image types are ever shown inline.
- Deleting the uploader's account keeps the file and empties `uploader_id`.
- Deleting a card or a project deletes its file rows (and a message's files go with the message row, in the same way). Only the API can delete the stored objects, so it does that itself when a card is deleted (or its files are moved to another card first). A deleted message keeps its row and text (rule 5); in PR B, deleting a message will remove its files too (decided 2026-11-14, not built yet), and rule 5 will say so then. Deleting boards and projects is not built yet; when it is, it must delete their files' stored objects as well.
- The Activity kinds `FILE_ADDED`, `FILE_REMOVED` and `FILE_MOVED` are part of the `activity_kind` type. History stays append-only. A `FILE_MOVED` line is written on the card that took the file, and a `FILE_REMOVED` for a file removed while its card is deleted with a move goes on that same card.

## Behaviour decided so far

- A new board starts with the columns To do, In progress and Done, and its general chat.
- A new card always gets its own chat, created with it. A chat made on its own can be linked to a card later, and a link can be removed.
- New cards, and cards moved to another column, go to the bottom of that column.

## Decisions and trade-offs

- **"Chat", not "channel".** A card's chat and a board's chat are the same kind of thing. Until 2026-10-31 the database and code called it a thread; the migration `rename_threads_to_chats` renamed the table in place, keeping its rows. "Thread" now means only the replies to one message (CONTEXT.md).
- **Generic Link table.** One table is simple, but the database cannot check that the target exists. The alternative is separate tables for each kind of link, which is stricter but longer. Revisit when links are built.
- **AI settings.** AI is switched on per project by an admin, so the setting lives in `ProjectAiConfig`. Once on, every chat in the project can be sent to the AI provider. A way to exclude individual chats may be added later.
- **API keys.** Stored encrypted and never returned by the API.

## Card features (planned)

[card-features.md](card-features.md) describes what cards will do. This section lists the database changes it needs. They will be added one pull request at a time, each with its own database tests.

**Built so far:** project codes and card numbers, files on cards (File table), subtasks, completion and done columns, old card numbers, estimates, time entries and timers, assignees, labels, priority, due dates, card creators, checklists and card history. The tables below are marked ✓ where built. Their rules are tested in `apps/api/src/projects/numbering-rules.db-spec.ts`, `apps/api/src/cards/subtask-rules.db-spec.ts`, `apps/api/src/time/time-rules.db-spec.ts`, `apps/api/src/cards/card-fields-rules.db-spec.ts` `apps/api/src/checklists/checklist-rules.db-spec.ts`, `apps/api/src/activity/activity-rules.db-spec.ts` and `apps/api/src/files/file-rules.db-spec.ts`.

### Changes to existing tables

| Table | New fields | Why |
|---|---|---|
| Project | ✓ code (2 to 6 capitals, unique), ✓ next_card_number, ✓ time_zone (set by admins; used for the days of due dates and time entries), ✓ relation_colours (one colour for each relationship; checked by the database) | Card numbers like `WEB-12`; relationship colours are a project setting only admins change |
| Column | ✓ is_done | Moving a card into a done column ticks it complete |
| Card | ✓ project_id, ✓ parent_id (nullable), ✓ number_path (e.g. `12.1.2`), ✓ next_subtask_number, ✓ depth, ✓ is_complete, ✓ completed_at, ✓ priority, ✓ due_at, ✓ due_has_time, ✓ estimate_minutes, ✓ created_by_id (replaces the single assignee_id) | Subtasks, card numbers, completion, priority, due dates, estimates, delete permission |

### New tables

| Entity | Purpose | Key fields |
|---|---|---|
| ✓ CardAssignee | Who is assigned to a card | card_id, project_id, user_id, is_owner, assigned_at |
| ✓ Checklist | A named checklist on a card | id, card_id, project_id, name, position |
| ✓ ChecklistItem | One tick-box item in a checklist | id, checklist_id, text, is_done, position |
| ✓ Label | A project-wide label | id, project_id, name, colour (one of a fixed set of 10) |
| ✓ CardLabel | Which labels a card has | card_id, label_id, project_id |
| ✓ TimeEntry | Time someone spent on a card | id, project_id, card_id, user_id, work_date (the day, in the project's time zone; entries logged before 2026-11-03 keep theirs), minutes, note, started_at, ended_at, needs_review |
| ✓ RunningTimer | A timer that is running now | user_id (primary key, so one per person), project_id, card_id, started_at, work_date (the day it started, in the project's time zone; kept if the zone changes while it runs) |
| ✓ CardActivity | The card's history (Activity tab) | id, card_id, project_id, actor_id, kind, details (names copied in when written), created_at, sequence (the order lines were written) |
| ✓ CardNumberAlias | Old card numbers that still lead to the card | project_id, number_path, card_id |
| ✓ ProjectCode | Every code a project has had, current and old, so old codes still work. The code is the primary key, so no two projects ever share one | code, project_id |

### Rules the database will enforce

- ✓ A parent and its subtask are in the same project (`card.project_id` with composite foreign keys), but may be on different boards.
- ✓ Subtasks go at most 5 levels deep (`depth` between 0 and 4, check constraint).
- ✓ A card number is unique within its project. Old numbers never clash with live ones, because new numbers always come from counters that only go up.
- ✓ A card with subtasks cannot be deleted directly; the API asks what to do with each subtask first.
- ✓ A completion time is recorded exactly when a card is complete.
- ✓ A card has at most one owner among its assignees (partial unique index), and assignees must be project members (foreign key to the membership, so leaving a project removes the person's assignments).
- ✓ A label name is unique within its project (the API also refuses names that differ only in letter case), is not blank, and a label only goes on cards in its own project.
- ✓ A due date without a time is stored as midnight UTC of that day.
- ✓ A checklist is in its card's project, its name is 1 to 100 characters, and an item's text is 1 to 500 characters.
- ✓ A time entry is 1 minute to 24 hours, and a timer entry has a start and a later end.
- ✓ A time entry is in its card's project, and a card with logged time cannot be deleted.
- ✓ An estimate is not negative.
- ✓ Card history is append-only: a trigger refuses any update or delete, except deleting it with its card or project and clearing the person when their account is deleted. History stays in its card's project.

### Decisions still to make while building

- ✓ **Rollups.** Estimate and time totals are worked out with a recursive query when read, not stored. Stored totals can drift out of date, so they will only be added if reading becomes slow.
- ✓ **Number paths.** `number_path` is stored, and the subtasks' paths are rewritten when a card moves to another parent. The old paths are saved as aliases at the same time.

## Not in this version

Message replies inside a thread, reactions, link previews, unread markers, @mentions, file versions, notifications, task dependencies, milestones.
