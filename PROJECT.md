# Tessera: project vision and decisions

> Status: DRAFT v0.4. Working title. Open questions are listed at the end.

## One-line description

Open source project workspace where every conversation is tied to the work it is about, every piece of work has its conversation and files attached, and an AI assistant helps keep the two in step.

## The problem

Teams running complex projects usually split their work across a chat tool (e.g. Slack) and a separate task tool. This causes:

- Chat is disconnected from the tasks and user stories used to manage projects and improvements.
- Threads and files are hard to find, because the only structure is the channel they happened in.
- Kanban cards created in other apps do not link back to the chats where the work was discussed.
- When several people work on a project, the discussion about *how* it is managed and the files it produces end up in separate places.

## The core idea

**Every piece of work has a conversation, and every conversation can have a piece of work.**

- Creating a card (task / user story) creates its own chat.
- Creating a chat asks the user whether to create a card for it.
- Either side can be created later: a card can gain a chat, and a chat can gain a card, whenever the team decides it is needed.
- A card has at most one chat of its own, but can link to other cards, chats and messages.
- Every board also has a general chat, created with the board, that is not tied to any card.
- Files attach to the card or message they belong to, so they are found by context, not by searching.

## Users

- Small to medium teams working together on complex projects.
- A mix of technical and non-technical people, so the interface must stay simple.

## Terminology (draft, to be confirmed)

- **Project**: the top-level container for a team's work.
- **Board**: both a kanban board and a chat space. Holds cards and chats, plus one general chat.
- **Card**: a task or user story. Has at most one chat of its own. A new card gets one, and it can be unlinked later.
- **Chat**: a conversation inside a board. May be linked to a card.
- **Message**: one post in a chat.
- **Thread**: the replies to one message, opened in their own sub-window.
- **Link**: a connection between chats, cards and messages, with a type the person picks from a list the project admin keeps.
- **Subtask**: a card that has a parent card. See [docs/card-features.md](docs/card-features.md).

## AI assistant (central theme)

AI assistance is part of the core design, not an add-on.

- First features: summarise a chat, and answer questions about a project.
- Claude is the first supported provider. A small provider layer lets teams choose their own provider, including a locally hosted model.
- Privacy by default: AI is off for every project. Only a project admin can turn it on, and it then applies to that whole project.
- The assistant proposes, and people approve, before anything is changed.

## Version 1 (MVP) scope

Focus: the chat-to-card relationship.

1. Users and sign-in; a project with members.
2. Boards with kanban cards, a general chat, and multiple chats.
3. Card and chat linking, including the "create a card?" prompt and retroactive creation.
4. File upload attached to a card or message.
5. AI provider layer with chat summaries and project questions, off by default.

## Planned after the MVP

- Task table view
- Gantt chart view
- Milestones and task dependencies
- Search across chat, cards and files
- Notifications

## Non-goals (for now)

- Not a document editor.

## Principles

- Open source under AGPL-3.0.
- Web application, cloud-hosted eventually, and also self-hostable on local servers (packaged with Docker Compose).
- Built in small steps, each one tested before moving on (test-driven development).

## Proposed technology (to be confirmed as we build)

TypeScript end to end: NestJS backend, React frontend, PostgreSQL database, MinIO file storage, WebSockets for real-time chat, Docker Compose for packaging.

## Open questions

1. **Excluding chats from AI.** Once a project admin turns AI on, it covers the whole project. Should individual chats be excludable later?
2. **Name.** "Tessera" is a working title; other software already uses it. Re-check before public launch.
