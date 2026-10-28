# Card features v1

Status: agreed with the project owner on 2026-10-27. The tables these features need are listed in [data-model.md](data-model.md#card-features-planned). Sections 1, 3, 4, 5, 6 and 10, and section 8 apart from attachments, are built in the API. The rest is not built yet.

Words used here: a **card** is a task or user story. A **subtask** is a card that has a parent card. A **project code** is the short letters at the start of card numbers (for example `WEB`).

## 1. Card numbers

- Each project has a **project code** of 2 to 6 capital letters. The admin sets it when creating the project, with a suggestion made from the project name.
- Cards are numbered within the project: `WEB-12`. Subtasks extend their parent's number: `WEB-12.1`, `WEB-12.1.2`.
- When a subtask moves to another parent its number changes, for example from `WEB-12.1` to `WEB-15.3`. The old number keeps working as an alias: searching for it or clicking it opens the card. The card's history records the change.
- The project code can be changed later. Old codes keep working as aliases.

## 2. Description and checklists

- The description is edited with a rich-text toolbar and stored as Markdown.
- **Checklists** are separate from the description. They are tick-box items under the card, each with text and a tick, and they can be reordered.
- Any checklist item can be **turned into a subtask**.
- A checklist's progress ("2 of 4") shows only on its own card. It does not count towards a parent's progress.

## 3. Assignees

- A card can have several assignees, and **one of them is the owner**.
- Only project members can be assigned.
- A new subtask starts unassigned. It does not copy the parent's assignees.
- The **first person assigned becomes the owner**. If the owner is removed, the person assigned longest becomes the owner. (Agreed 2026-10-28.)
- Leaving a project removes the person from the cards they were assigned to. (Agreed 2026-10-28.)
- Any member can change a card's owner, as any member can edit cards. (Agreed 2026-10-28.)

## 4. Subtasks

- A subtask is an ordinary card with a parent card. It has its own column, assignees, estimate, time, checklist and thread.
- Subtasks can be nested **up to 5 levels** deep.
- A subtask can be on **any board in the same project**, but never in another project.
- The parent card shows a **list of its subtasks**, and each subtask shows its parent.
- **Progress** on a parent ("3 of 5 complete") counts its **direct subtasks only**.
- A parent is **never completed automatically**. Completing a parent while some subtasks are open asks: "3 subtasks are still open. Complete anyway?"
- **Deleting a parent:** the user chooses what happens to each direct subtask. It can be deleted too, moved to another parent, or made into a card of its own. Deeper subtasks stay with their own parent.
  - A direct subtask that has subtasks of its own **cannot be chosen for deletion** until the user has decided what happens to its subtasks. This stops one click deleting a whole branch. (Agreed 2026-10-27.)

## 5. Completing cards

- Each card has a **complete** tick.
- Each board marks one or more columns as **"done" columns**. On new boards the Done column is marked.
- Moving a card into a done column ticks it complete, and moving it out of a done column into one that is not done unticks it. Ticking a card complete offers to move it to the board's done column.
- Unticking a card that is in a done column **leaves it where it is**. (Agreed 2026-10-27.)
- When a subtask is completed, its parent's progress updates.

## 6. Estimates and time

- Estimates are in **hours and minutes**.
- **Estimate rollup:** a card with subtasks shows the sum of its subtasks' estimates, at every level. Its own estimate is no longer counted. It is kept and shown greyed out as the "original estimate".
- **Time spent rollup:** a card's total is its own logged time plus all its subtasks' time, at every level. Time logged directly on a parent still counts.
- **Time entries** hold the person, card, date, duration and an optional note. A timer entry also stores its start and end times.
- Time can be added with a **start/stop timer** or **typed in by hand**. Stopping a timer creates an ordinary entry.
- **One running timer per person.** Starting a timer while another is running warns that the first will stop. If the person goes ahead, the first timer stops and its time is saved as an entry.
- **Editing entries:** a person can edit or delete their own entries for 24 hours. After that only admins can. Every change is recorded in the card's history.
- Everyone in the project can see all time entries.
- One entry is **1 minute to 24 hours**, and time cannot be logged for a future day. (Agreed 2026-10-28.)
- A timer that runs past midnight saves its time on the **day it started**. (Agreed 2026-10-28.)
- A card with logged time **cannot be deleted**, so hours never quietly disappear from reports. The refusal says how much time is logged. An admin can delete the entries first. (Agreed 2026-10-28.)
- Edits to time entries will be recorded in the card's history once the Activity tab (section 9) is built. (Agreed 2026-10-28.)
- A timer stopped within 30 seconds saves nothing. Otherwise timer time is rounded to the nearest minute. (Agreed 2026-10-28.)
- A timer left running for more than 24 hours saves 24 hours and the entry is **flagged for review**. The flag clears when the person or an admin edits or confirms the entry. (Agreed 2026-10-28.)
- "A future day" means a day that has not started anywhere in the world yet, because the server does not know the person's time zone when time is typed in. (Agreed 2026-10-28.)
- Deleting a card that has a running timer stops the timer without saving it. This can only happen when the card has no logged time. (Agreed 2026-10-28.)
- A person who has logged time cannot be deleted, so their hours are kept. (Agreed 2026-10-28.)

## 7. Seeing related cards

- Selecting a card outlines its relatives in colours that depend on the relationship, and fades the other cards:
  - selected card: dark outline
  - parent and higher levels: blue
  - direct subtasks: orange
  - deeper subtasks: paler orange
  - sibling subtasks (same parent): grey
- Each highlight also has a small text tag such as "Parent" or "Subtask", so colour is never the only signal.
- The colours are a **project setting that only admins can change**, so everyone in the project sees the same colours.
- Related cards on other boards are listed in the card's panel, with links to them.

## 8. Other card fields

- **Priority:** None, Low, Medium, High or Urgent.
- **Due date:** a date, with an optional time. If a subtask is due after its parent, both cards show a warning. The date is not blocked. The warning is worked out when a card is read, not stored. Two times are compared exactly. When either card has no time, only the days are compared, and a due time's day is the day it falls on in the **project's time zone**. (Agreed 2026-10-28.)
- Each project has a **time zone**, set by an admin. New projects start on UTC. (Agreed 2026-10-28.)
- **Labels** are shared across the whole project and each has a name and a colour. Any member can create a label. Only admins can rename, recolour or delete one. Names are up to 50 characters. Colours come from a **fixed set of 10** that read well in light and dark mode (grey, red, orange, yellow, green, teal, blue, indigo, purple, pink), and two labels in a project cannot have the same name in any letter case. (Agreed 2026-10-28.)
- **Attachments:** a file can be attached to the card itself or to a message in its thread. The card lists files from both. The default limit is 100 MB per file, and admins of a self-hosted server can change it. Attachments come in a later pull request, once file storage (MinIO) is set up. (Agreed 2026-10-28.)

## 9. History

- Each card has an **Activity** tab. It records every field change, move, completion, assignment, subtask change and time-entry edit, with who made it and when.
- History lines are **not** posted into the card's thread.

## 10. Permissions

- Any project member can create, edit, move and complete cards, and log time.
- Any project member can mark which columns are done columns. (Agreed 2026-10-27.)
- Deleting a card: the person who created it, or an admin. Cards made before creators were recorded can only be deleted by admins. When a parent is deleted, the same rule applies to each subtask chosen for deletion. (Agreed 2026-10-28.)
- Editing other people's time entries, or any entry older than 24 hours: admins only.
- Renaming, recolouring or deleting labels, setting the project code and time zone, and changing the relationship colours: admins only.

## 11. Boards

- A board cannot be deleted while any of its cards have subtasks on another board. Those subtasks must be moved or deleted first, so no subtask is left with its parent gone. Deleting boards is not built yet. (Agreed 2026-10-27.)

## Later (not in the first version)

Start dates (needed for the Gantt chart), links between cards ("blocks", "relates to"), watchers and notifications, and story points as an alternative to hours.
