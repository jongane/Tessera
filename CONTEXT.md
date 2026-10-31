# Tessera

An open source project workspace where every conversation is tied to the work it is about. This glossary fixes the words used in the code, the docs and the app's screens.

## Work

**Project**:
The top-level container for a team's work, with its members, boards and labels.
_Avoid_: Workspace, team

**Project code**:
The 2 to 6 capital letters that start a project's card numbers, such as `WEB`.
_Avoid_: Prefix, key

**Board**:
A kanban board and a chat space in one: it holds columns of cards, and chats.
_Avoid_: Channel, space

**Column**:
One list of cards on a board, such as "In progress".
_Avoid_: Lane, status, list

**Done column**:
A column that completes a card when the card is moved into it.

**Card**:
A task or user story on a board.
_Avoid_: Task, ticket, issue, story

**Subtask**:
A card that has a parent card.
_Avoid_: Child task, sub-card

**Card number**:
A card's project-wide identifier, such as `WEB-12` or `WEB-12.1` for a subtask. Old numbers keep working as aliases.
_Avoid_: Card ID, ticket number

**Assignee**:
A project member assigned to a card.

**Owner**:
The one assignee who is responsible for a card.
_Avoid_: Lead, primary assignee

**Checklist**:
A named list of tick-box items on a card, separate from its description.
_Avoid_: To-do list

**Time entry**:
An amount of time a person logged on a card for one day, typed in or saved from the timer.
_Avoid_: Timesheet line, log

## Conversation

**Chat**:
A conversation inside a board. A card has at most one chat of its own, and a chat can exist without a card. (Agreed 2026-10-31.)
_Avoid_: Channel, conversation, chat window

**General chat**:
The one chat every board has from the start, never linked to a card.
_Avoid_: Main chat, board chat, general thread

**Message**:
One post in a chat.
_Avoid_: Comment

**Thread**:
The replies to one message, kept with that message in its chat. A thread's replies open in their own sub-window. (Agreed 2026-10-31.)
_Avoid_: Using "thread" for a whole chat

**Link**:
A connection between chats, cards and messages. The person making it picks its type from a list the project admin keeps, such as "blocks" or "needs resource". (Agreed 2026-10-31.)
_Avoid_: Relation, reference

## People

**Member**:
A person who belongs to a project, either as a project admin or an ordinary member.
_Avoid_: User (when project membership is meant), collaborator

**Project admin**:
A member who can manage the project's settings and members.

**Server admin**:
A person who manages the whole Tessera server, such as switching sign-up on or off.
_Avoid_: Super user, owner
