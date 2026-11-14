# Roadmap

Status: agreed with the repository owner on 2026-11-08. The `docs-keeper` agent updates it whenever a pull request finishes or starts a step (agreed 2026-11-08).

This page shows what is built, what is left for the first version (the MVP), and what comes after. The MVP scope itself is defined in [PROJECT.md](../PROJECT.md) ("Version 1 (MVP) scope"); this page tracks progress against it and suggests an order. Words follow [CONTEXT.md](../CONTEXT.md).

## Where we are

The API and the web app cover accounts, projects, boards, cards with every card feature planned for the first version, chats with messages (sending, editing, deleting; #44), and live updates (#45). Boards, cards, the open card, chats and messages now update without a reload. Step 3, files, is in progress: files on cards are built in the pull request on branch `feat/card-files` (PR A, not merged yet), and files on messages come next (PR B). AI is not started.

## The flowchart

```mermaid
flowchart TD
    classDef done fill:#d1fae5,stroke:#047857,color:#064e3b
    classDef next fill:#fef3c7,stroke:#b45309,color:#78350f
    classDef mvp fill:#dbeafe,stroke:#1d4ed8,color:#1e3a8a
    classDef later fill:#f3f4f6,stroke:#6b7280,color:#111827
    classDef idea fill:#ffffff,stroke:#9ca3af,color:#374151,stroke-dasharray: 4 4

    subgraph Built["Built (merged PRs up to #44, and #45)"]
        F[Foundation: repo, CI, Claude review, sub agents]
        A[API: accounts, projects, boards, cards, chats, card features]
        W[Web app: sign in, board view, chat panel, settings, card panel]
    end

    subgraph MVP["To finish the MVP"]
        N1[Step 1: Refuse hidden NUL characters in text fields]
        N2[Step 2: Chat messages and live updates]
        N3[Step 3: Files on cards (PR A, in progress) and on messages (PR B)]
        N4[Step 4: AI: provider layer, chat summaries, project questions]
        R([MVP complete])
    end

    subgraph After["After the MVP"]
        L1[Thread replies and typed links]
        L2[Accounts and setup extras]
        L3[Task table, Gantt chart, milestones, dependencies]
        L4[Search, notifications, watchers]
        L5[Chat panel windows, smaller items, usability review]
    end

    subgraph Ideas["Ideas, not scheduled"]
        I1[Git-backed file storage]
        I2[Audio and video chat]
    end

    F --> A --> W --> N1 --> N2 --> N3 --> N4 --> R
    R --> L1 & L2 & L3 & L4 & L5
    R -.-> I1 & I2

    class F,A,W,N1,N2 done
    class N3 next
    class N4,R mvp
    class L1,L2,L3,L4,L5 later
    class I1,I2 idea
```

Green is done, amber is in progress or next, blue is the rest of the MVP, grey is after the MVP, and dashed boxes are ideas.

## MVP progress

| MVP item (from PROJECT.md) | Status |
|---|---|
| 1. Users and sign-in; a project with members | Done |
| 2. Boards with kanban cards, a general chat, and multiple chats | Done: boards, cards, chats, chat messages (#44) and live updates (#45) |
| 3. Card and chat linking, the "Create a card?" prompt and retroactive creation | Done |
| 4. File upload attached to a card or message | In progress: files on cards are built in PR A (this pull request, not merged yet; storage is SeaweedFS). Files on messages and screenshots in the message box are PR B |
| 5. AI provider layer with chat summaries and project questions, off by default | Not started |

## Suggested order to finish the MVP

Each step gets its own plan, approved before building, as usual.

1. **Refuse hidden NUL characters** in every text field. A small clean-up left from web PR 7. Done in #43.
2. **Chat messages and live updates**, in two pull requests (agreed 2026-11-09). Messages come before attachments and AI because both depend on them. Done.
   - **Chat messages:** built in #44. Sending, editing, deleting, Markdown, card-number and website links.
   - **Live updates (WebSockets):** built in #45. They cover messages, board cards, the open card panel and the sidebar's chat list, and the 30-second reload is gone ([web-app.md](web-app.md) section 6, [api.md](api.md) "Live updates", [ADR 0002](adr/0002-live-updates-signals-then-reload.md)). Older messages kept on screen now show other people's edits and deletes.
3. **Files** (in progress) on a card or on a message, kept in SeaweedFS through the S3 API, 100 MB per file by default ([card-features.md](card-features.md) section 8, [ADR 0003](adr/0003-files-in-seaweedfs-through-the-s3-api.md)). Two pull requests, one after the other (agreed 2026-11-14):
   - **PR A, files on cards** (this pull request, not merged yet): file storage, and attaching, listing, downloading, previewing and removing files on a card, with the Files section in the card panel and the choice of what to do with the files when a card is deleted.
   - **PR B, files on messages** (next): attaching files to messages (up to 10), pasting and dropping screenshots into the message box, the "from chat" files in a card's Files section, and removing a message's files when the message is deleted (decided 2026-11-14).
4. **AI**: the provider layer (Claude first), turning AI on per project by a project admin, summarising a chat and answering questions about a project.

## Done so far

| Area | What was built | Pull requests |
|---|---|---|
| Foundation | README, CI (Shared, API, Web and Browser jobs, started in the initial scaffold), Claude review check, sub agents, dependency security fixes | #1, #19, #21, #23, #24, #33, #34 |
| Database | PostgreSQL and Prisma; users, projects, members, boards, columns, cards, chats | #2, #3 |
| Card features (API) | Card numbers, subtasks, completion, estimates, time tracking, assignees, labels, priority, due dates, checklists, Activity history | #4 to #10, #15 |
| Endpoints | Accounts, sign-in and members; endpoints for everything above | #11, #12, #14 |
| Web app design | Web app spec, glossary, first ADR, shared validation package | #16, #17 |
| API for the web app | Card order, board card summaries, new card from a chat, chat rename, relationship colours, card search, time in the project's time zone, subtask list details | #18, #25, #26, #28, #30, #35, #36, #37 |
| Web app | Sign in and projects, board view and dockable chat panel, project settings and admin screen, card panel, checklists, subtasks, time and timer, Activity tab | #22, #27, #29, #31, #32, #38 to #41 |
| Input safety | Hidden NUL characters refused in every text field and anywhere in a request ([api.md](api.md) "Text with a hidden character") | #43 |
| Chat messages | Messages table, API to send, list, edit and delete messages, and the chat panel's message list and message box | #44 |
| Live updates | Socket.IO live connection with "something changed" signals, boards, the open card, the chat list and messages updating without a reload, the "Reconnecting…" bar, a panel for when someone changes the field you are editing, and `GET /api/messages/:id` | #45 |

## After the MVP

Not yet ordered. Each gets its own plan when its turn comes.

- **Chat extras**: thread replies opening in their own sub-window, reactions, and typed links between chats, cards and messages (types kept by a project admin, see [CONTEXT.md](../CONTEXT.md) "Link"). Card-to-card links ("blocks", "relates to") from [card-features.md](card-features.md) may share the same list of types.
- **Local disk file storage**: an option to keep files in a folder on the server's own disk instead of an S3 store. The `FileStore` interface in the API is made for it ([ADR 0003](adr/0003-files-in-seaweedfs-through-the-s3-api.md); agreed 2026-11-14).
- **Accounts and setup**: email invitations and "forgot password" (needs email sending), renaming a project and changing its description, remembering panel layout in the account instead of the browser, and a ready-to-run self-host package (Docker Compose for the whole app).
- **Chat panel**: a floating window and a separate browser window.
- **Planning views**: task table, Gantt chart (needs start dates on cards), milestones and task dependencies.
- **Finding and following**: search across chats, cards and files; notifications and watchers.
- **Smaller items**: story points as an alternative to hours, moving checklist items between checklists, file versions, and a way to exclude single chats from AI (open question in PROJECT.md).
- **Quality**: a functionality and usability review of the running web app.

## Ideas, not scheduled

- Git-backed file storage for chats, aimed at distance teams.
- Audio and video chat attached to chats.
