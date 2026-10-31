# Web API

The API is what the web app (and anything else) talks to. Every address starts with `/api`, and request and response bodies are JSON. When the API runs locally, it is at http://localhost:3000/api.

Status: every feature the API has so far can be reached through these endpoints. File attachments, chat messages and the AI features come later.

## How signing in works

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as Database
    B->>A: POST /api/auth/sign-in (email, password)
    A->>D: Find the account, check the password hash
    A->>D: Save a new session (only a hash of its token)
    A-->>B: 200, and a cookie holding the token
    B->>A: Any later request (the cookie is sent automatically)
    A->>D: Find the session by the token's hash
    A-->>B: The answer, or 401 if the session ended
```

- **The cookie** is called `tessera_session`. It is `HttpOnly`, so scripts on a page cannot read it. It is also `SameSite=Lax`, so other websites cannot make the browser send it with their forms. In production it is also `Secure`, so it is only sent over HTTPS.
- **Sessions last 30 days** and move forward while they are used. Signing out ends the session. Changing your password ends all your sessions, but keeps the browser that made the change signed in.
- **Passwords** are at least 10 characters. They are stored only as a scrypt hash: a one-way scramble that is slow to compute on purpose, so a stolen database is very hard to guess passwords from.
- **Guessing is slowed down.** After 5 failed sign-ins for one email in 15 minutes, that email has to wait. The answer is 429 with a `Retry-After` header giving the wait in seconds. A wrong password and an unknown email get the same answer, so nobody can check which emails have accounts by trying to sign in.
- **Sign-up** is open to anyone unless a server admin switches it off. The first account on a new server becomes its server admin, and can always be made.

## Answers you can get

| Code | Meaning |
|---|---|
| 200 / 201 / 204 | Done (201: something was created, 204: done, nothing to send back) |
| 400 | The input is wrong; `message` says what. Unknown fields are refused too |
| 401 | Not signed in, or the session has ended |
| 403 | Signed in, but not allowed (for example, not a project admin) |
| 404 | Not found, or in a project you are not a member of. The two are not told apart, so nobody can find out which projects exist |
| 409 | Clashes with something, for example the email already has an account |
| 429 | Too many failed sign-ins; wait and try again |

## Endpoints

### Accounts and sign-in

| Method and path | Who | What it does |
|---|---|---|
| `POST /api/auth/sign-up` | Anyone (unless sign-up is off) | Body `{ email, displayName, password }`. Creates the account and signs it in |
| `POST /api/auth/sign-in` | Anyone | Body `{ email, password }`. Signs in |
| `POST /api/auth/sign-out` | Anyone | Ends this browser's session |
| `GET /api/auth/me` | Signed in | The signed-in person: `{ id, email, displayName, isServerAdmin }` |
| `POST /api/auth/password` | Signed in | Body `{ currentPassword, newPassword }`. Changes the password |

### Server settings

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/server/settings` | Anyone | `{ signUpOpen }`, so the sign-up page knows whether to show itself |
| `PATCH /api/server/settings` | Server admins | Body `{ signUpOpen }`. Switches sign-up on or off |

### Project members

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/projects/:projectId/members` | Members | Everyone in the project, admins first, then by name |
| `POST /api/projects/:projectId/members` | Project admins | Body `{ email, role? }`. Adds the person who has an account with that email. `role` is `MEMBER` (the default) or `ADMIN` |
| `PATCH /api/projects/:projectId/members/:userId` | Project admins | Body `{ role }`. Changes someone's role |
| `DELETE /api/projects/:projectId/members/:userId` | Project admins, or the person themselves (leaving) | Removes someone. Their card assignments go, and a timer they have running in the project is stopped and its time saved |

A project always keeps at least one admin: making the last admin a member, or removing or leaving as the last admin, gets 409.

Email invitations and "forgot password" need the server to send email, so they come later.

### Projects

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/projects` | Signed in | The projects you are a member of, by name |
| `POST /api/projects` | Signed in | Body `{ name, code, description? }`. Creates a project, with you as its admin. `code` is 2 to 6 letters (e.g. `WEB`) |
| `GET /api/projects/suggest-code?name=...` | Signed in | `{ code }`: the first free code made from a project name, for the "new project" form |
| `GET /api/projects/:projectId` | Members | One project |
| `GET /api/projects/by-code/:code` | Members | A project by its code. Old codes work too |
| `PATCH /api/projects/:projectId` | Project admins | Body `{ code?, timeZone? }`. Changes the code (old card numbers keep working) or the time zone (e.g. `Europe/London`) |

### Boards and columns

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/projects/:projectId/boards` | Members | The project's boards, by name |
| `POST /api/projects/:projectId/boards` | Members | Body `{ name }`. Creates a board with the columns To do, In progress and Done, and its general chat |
| `GET /api/boards/:boardId` | Members | The board with its `columns` in order, each with its `cards` from top to bottom. Each card also has its `number` (`WEB-12`), `labels` (by name), `assignees` (owner first), `checklistProgress` `{ done, total }`, `subtaskProgress` `{ complete, total }` (direct subtasks only) and `chatId`, so the board needs no request per card |
| `PATCH /api/columns/:columnId` | Members | Body `{ isDone }`. Marks a column as a done column, or not |

### Cards

| Method and path | Who | What it does |
|---|---|---|
| `POST /api/columns/:columnId/cards` | Members | Body `{ title, description?, chatId? }`. Creates a card at the bottom of the column, with the next number and its own chat. With `chatId`, the card takes that chat instead of a new one ("Create a card for this chat?"). The chat must be on the same board and not linked to a card, and can't be the general chat (409) |
| `GET /api/cards/:cardId` | Members | The card, with its full `number` (e.g. `WEB-12.1`) and its `chat` |
| `GET /api/cards/by-number/:number` | Members | A card by its number, e.g. `WEB-12`. Old numbers and codes work too |
| `PATCH /api/cards/:cardId` | Members | Body with any of `title`, `description` (empty clears it), `priority` (`NONE`, `LOW`, `MEDIUM`, `HIGH` or `URGENT`), `due` and `estimateMinutes` (null clears it). `due` is `{ "date": "2026-11-02" }`, `{ "at": "2026-11-02T17:00:00+01:00" }` (the offset is required) or null. Everything is checked before anything changes. Answers with the card |
| `POST /api/cards/:cardId/move` | Members | Body `{ columnId, position?, confirmOpenSubtasks? }`. Moves the card to another column on its board, or to another place in its own column. `position` 0 is the top; past the end, or left out, is the bottom. Into a done column completes it; out of one reopens it. Moving between columns is recorded in the card's history; reordering within a column is not |
| `POST /api/cards/:cardId/complete` | Members | Body `{ confirmOpenSubtasks? }`. Completes the card. Answers `{ card, doneColumnId }`: the done column to offer moving it to, or null |
| `POST /api/cards/:cardId/reopen` | Members | Reopens the card |
| `DELETE /api/cards/:cardId` | The card's creator, or a project admin | Deletes the card; its chat is kept, unlinked. A card with subtasks needs body `{ subtasks: { "<subtask id>": { "action": "delete" or "standalone" } or { "action": "move", "parentId": "..." } } }` with a choice for each direct subtask |

Completing a card, or moving it into a done column, while some of its direct subtasks are open gets 409 with `openSubtasks` (how many). Send the request again with `confirmOpenSubtasks: true` to go ahead. Deleting a card with logged time gets 409 with `loggedMinutes`.

### Chats

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/boards/:boardId/chats` | Members | The board's chats: the general chat first, then the others oldest first |
| `POST /api/boards/:boardId/chats` | Members | Body `{ title }`. Creates a chat that is not linked to a card |
| `PUT /api/chats/:chatId/card` | Members | Body `{ cardId }`. Links the chat to a card on the same board. A card has at most one chat, and the general chat can't be linked (409) |
| `DELETE /api/chats/:chatId/card` | Members | Removes the link. The chat and the card are both kept |

### Subtasks

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/cards/:cardId/subtasks` | Members | `{ subtasks, progress }`: the direct subtasks in number order, and `{ complete, total }` |
| `POST /api/cards/:cardId/subtasks` | Members | Body `{ columnId, title, description? }`. A subtask in any column of the project, numbered under the card (`WEB-12.1`). At most 5 levels deep (409) |
| `PUT /api/cards/:cardId/parent` | Members | Body `{ parentId }`, or null for the top level. Moves the card with its own subtasks. They get new numbers, and the old ones keep working |
| `GET /api/cards/:cardId/due-warnings` | Members | `{ dueAfterParent, subtasksDueAfter }`, for the "due after its parent" warnings |

### Assignees

Each of these answers with the card's assignees afterwards, owner first.

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/cards/:cardId/assignees` | Members | The assignees, each with `user` and `isOwner` |
| `PUT /api/cards/:cardId/assignees/:userId` | Members | Assigns a project member. The first person assigned becomes the owner |
| `DELETE /api/cards/:cardId/assignees/:userId` | Members | Unassigns. Removing the owner hands ownership to the person assigned longest |
| `PUT /api/cards/:cardId/owner` | Members | Body `{ userId }`, who must already be assigned |

### Labels

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/projects/:projectId/labels` | Members | The project's labels, by name |
| `POST /api/projects/:projectId/labels` | Members | Body `{ name, colour }`. `colour` is one of `GREY`, `RED`, `ORANGE`, `YELLOW`, `GREEN`, `TEAL`, `BLUE`, `INDIGO`, `PURPLE` or `PINK` |
| `PATCH /api/labels/:labelId` | Project admins | Body `{ name?, colour? }` |
| `DELETE /api/labels/:labelId` | Project admins | Deletes the label and takes it off every card |
| `GET /api/cards/:cardId/labels` | Members | The card's labels |
| `PUT /api/cards/:cardId/labels/:labelId` | Members | Puts a label on the card |
| `DELETE /api/cards/:cardId/labels/:labelId` | Members | Takes it off |

### Time

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/cards/:cardId/time-entries` | Members | Everyone's time on the card, latest day first, each with `user` |
| `POST /api/cards/:cardId/time-entries` | Members | Body `{ minutes, workDate, note? }`. 1 minute to 24 hours, on a day that has started somewhere in the world |
| `PATCH /api/time-entries/:entryId` | The person who logged it (for 24 hours), or a project admin | Body `{ minutes?, workDate?, note? }` (`note: null` removes it). Also clears the "needs review" flag |
| `DELETE /api/time-entries/:entryId` | Same as above | Deletes the entry |
| `GET /api/cards/:cardId/time-totals` | Members | Estimate and time spent, rolled up from the card's subtasks |
| `POST /api/cards/:cardId/timer` | Members | Body `{ timeZone?, stopRunning? }`. Starts your timer on the card. If yours is running on another card, you get 409 with `runningCardId`; send `stopRunning: true` to stop that one (its time is saved) and start this one |
| `GET /api/timer` | Signed in | `{ timer }`: your running timer, or null |
| `DELETE /api/timer` | Signed in | Stops your timer. `{ entry }` is the time saved, or null if it ran under half a minute. 404 if none is running |

### Checklists

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/cards/:cardId/checklists` | Members | The card's checklists in order, each with its `items` and `progress` (`{ done, total }`) |
| `POST /api/cards/:cardId/checklists` | Members | Body `{ name }`. `suggestNewCard` in the answer is true once the card has more than 10 |
| `PATCH /api/checklists/:checklistId` | Members | Body `{ name?, position? }`. Renames and/or moves it (0 is first) |
| `DELETE /api/checklists/:checklistId` | Members | Deletes it with its items |
| `POST /api/checklists/:checklistId/items` | Members | Body `{ text }`. Adds an item at the bottom; at most 100 (409) |
| `PATCH /api/checklist-items/:itemId` | Members | Body `{ text?, isDone?, position? }`. Edits, ticks and/or moves the item |
| `DELETE /api/checklist-items/:itemId` | Members | Deletes the item |
| `POST /api/checklist-items/:itemId/subtask` | Members | Replaces the item with an unassigned subtask of the card, titled with its text |

### Activity

| Method and path | Who | What it does |
|---|---|---|
| `GET /api/cards/:cardId/activity?limit=50&before=...` | Members | The card's history, newest first: `{ items, nextBefore }`. Each line has `kind`, `details`, `actor` and `createdAt`. Pass `nextBefore` as `before` to get the next, older page; it is null on the last page |
