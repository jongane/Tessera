# Web app v1

Status: agreed with the project owner on 2026-10-29 in a design session. Sections are built in the order of section 10. The look is shown in the board mock-up (the "Look" screens): https://claude.ai/artifact/7N2n8s3gW14KMZiNbMPRr1

Words used here follow [CONTEXT.md](../CONTEXT.md). The API the web app talks to is described in [api.md](api.md).

## 1. What the first release covers

- Sign in, sign up and sign out.
- The project list, with "New project".
- The board view: columns, cards, adding a card, dragging cards, and the board's chats in the sidebar.
- New chats, the "Create a card for this chat?" prompt, and linking or unlinking a chat and a card.
- The card panel with every card feature the API has: title, description, priority, due date, estimate, assignees and owner, labels, subtasks, checklists, time entries and the timer, completing and reopening, deleting, and the Activity tab.
- Project settings: members (add by email, change role, remove, leave), labels, project code and time zone. Every member can open it; for people who are not project admins it is read-only, except that they can add a label and leave the project (agreed 2026-10-31). Removing someone, leaving, deleting a label and changing the code ask "Are you sure?" first; role and time zone changes save straight away (agreed 2026-10-31). Renaming a project and changing its description come later, with a small API change.
- A server admin screen with the sign-up switch, and nothing else for now (no list of accounts; agreed 2026-10-31). Server admins reach it from the account menu.

Not in this release: chat messages (the API has none yet, so the chat panel shows a chat's title and its card, with "Messages are coming soon"), live updates, file attachments and AI features.

## 2. Screens and addresses

| Address | Screen |
|---|---|
| `/sign-in`, `/sign-up` | Signing in, and making an account. When sign-up is off, the sign-in page hides its "Create an account" link and `/sign-up` says "Sign-up is closed. Ask your server admin for an account." (agreed 2026-10-30) |
| `/projects` | Your projects. When empty, it offers "Create your first project" |
| `/WEB` | A project. It opens the last board you used in it, or offers "Create your first board" when it has none (agreed 2026-10-30). With no board remembered in this browser, or one that has gone, it lists the project's boards, with "New board" |
| `/WEB/boards/<board id>` | A board |
| `/WEB-12` | Opens card WEB-12 on its board, with the card panel open. Old card numbers and project codes keep working |
| `/WEB/settings` | Project settings |
| `/admin` | Server settings, for server admins. Anyone else sees "Page not found". No project may use the code `ADMIN`, because addresses ignore letter case (agreed 2026-10-31) |

- After signing in you land on the **last board you used**. The first time, you land on the project list.
- If your session has ended, you are sent to the sign-in page and brought back to the same place afterwards.

## 3. Layout of the board screen

- A sidebar on the left lists the project's boards and the board's chats: the general chat first, then the chats not linked to a card. A card's chat is opened from its card. (Agreed 2026-10-31 as a trial.)
- A chat with no card asks "Create a card for this chat?" in the chat panel. "Create a card" makes a card in the board's first column with the chat's title, and the card takes that chat as its own. "Link to a card" picks a card on the board, found by number or title. Only cards without a chat are offered, because a card has at most one chat. A linked chat can be unlinked from the panel, and both are kept. (Agreed 2026-10-31.)
- The board's columns fill the middle.
- The **card panel** and the **chat panel** are two separate panels, so you can read a card's chat while editing the card.
- When chat arrives, a message's **thread** (its replies) opens in its own sub-window, not inline in the chat (agreed 2026-10-31).
- People can dock the chat panel on the right, left or bottom, and drag its edge to resize it. A floating window and a separate browser window may come later, so the panel code must not assume where it sits.
- Clicking a card opens only its **card panel**, on the right of the board, with an edge that can be dragged to resize it. The panel has an "Open chat" button for the card's chat (agreed 2026-11-01). The address then ends in `?card=<id>`, so Back closes the panel.
- The card panel is one self-contained component. The board screen only decides where it is placed, so it can move into a dialog or onto its own page later with a small change.
- Panel positions are remembered in the browser for now. They must move to the person's account later (this needs a small API addition).
- Desktop and tablet come first. On a phone the screen stays usable: panels stack, and the card and chat panels become tabs.

## 4. Cards on the board

- Cards can be dragged up and down within a column and into other columns. Dragging also works with the keyboard, and every card has a "Move to" menu as a non-drag option.
- Dropping a card into a done column while some of its subtasks are open asks "Complete anyway?" first.
- A card shows its number, title, priority (when set), labels, due date, checklist and subtask progress, and its assignees. Checklist progress on the board is one total across all the card's checklists ("3 of 7"); the card panel shows each checklist's own progress (agreed 2026-10-30).
- The API's "move card" takes a `position` in the column, which covers both reordering within a column and dropping into another column at a chosen place (agreed 2026-10-29). Reordering within a column is not recorded in the card's history.

## 5. Editing

- The description is edited with a formatting toolbar (Tiptap) and stored as Markdown, as [card-features.md](card-features.md) says. It has Save and Cancel buttons.
- Small fields (title, priority, due date, estimate) save as soon as they change. Due times are typed in the project's time zone, which is shown next to the box (agreed 2026-11-01).
- Leaving a card with unsaved changes to its description asks "Discard your changes?" first.
- Everyone can see the "Delete card" button. For people who may not delete the card (only its creator or a project admin may), it is turned off and says why (agreed 2026-11-01).
- Quick actions such as dragging a card or ticking a checklist item show on screen straight away. If saving fails, the change is undone and a short message says "Couldn't save, try again".

## 6. Keeping screens up to date

- No live updates in this release. A screen reloads its data after your own changes, when you come back to the browser tab, and every 30 seconds while a board is open.
- Two people changing the same field: the last save wins.
- Live updates (WebSockets) are built together with chat, because chat needs them anyway.

## 7. Look

- Tailwind CSS for styling, and Radix for accessible building blocks (menus, dialogs, tabs).
- The mock-up's colours and the Inter font.
- Accessibility target: WCAG 2.2 AA (keyboard use, screen readers, contrast), with automatic checks (axe) in the tests.

## 8. Code structure

- The API's input rules (zod schemas) move into a shared package, `packages/shared`, used by both apps. Forms then show the same errors the API would give.
- The web app and the API are served from the same address, so the sign-in cookie just works. During development the web app's dev server passes `/api` requests on to the API. In production the API also serves the built web app, so `npm run start:prod -w apps/api` runs everything on one address (agreed 2026-10-30). See [ADR 0001](adr/0001-web-app-and-api-on-one-origin.md).
- What the API sends back is described by plain TypeScript types in `packages/shared` (`responses.ts`). The answers are not checked again at run time, because both apps are built together (agreed 2026-10-30).
- Data loading uses TanStack Query (caching, reloading on tab focus and every 30 seconds, undoing a failed change). Addresses use React Router. Dragging uses dnd-kit. (Library choices are confirmed in each PR's plan.)

## 9. Testing

- Component tests with Vitest and Testing Library, describing what a person sees. The API is faked with MSW.
- A few end-to-end tests in a real browser (Playwright) against the real API in CI: sign in, create a card, move it, open it. They run in their own CI job ("Browser"), which starts PostgreSQL and the API serving the built web app (agreed 2026-10-30). They also check accessibility with axe, colour contrast included.

## 10. Build order

One pull request at a time, each with its plan approved first:

1. Shared validation package (moves code, no change in behaviour).
2. API: card order within a column, and moving to a position.
3. Web foundation: addresses, API client, look, sign in and sign up, project list, first Playwright test.
4. Board view: columns, cards, dragging, chats in the sidebar, new chats and the "Create a card?" prompt, the chat panel and its docking.
   Then, as its own pull request: rename "thread" to "chat" in the API, database and code (agreed 2026-10-31; done). Messages, threads (replies) and typed links get their own design round with chat.
5. Project settings and the server admin screen.
6. Card panel basics: title, description, priority, due date, estimate, assignees, labels, completing, deleting, and seeing related cards ([card-features.md](card-features.md) section 7; agreed 2026-11-01).
7. Card panel extras: subtasks, checklists, time and the timer, Activity tab.
