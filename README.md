# Tessera

An open source project workspace that keeps chat, files and tasks in one place.

> **Status: early development.** The project is scaffolded but not usable yet. Expect things to change.

## Why Tessera?

Teams usually split their work between a chat tool and a separate task tool. Conversations drift away from the work they are about, and files get lost in old threads.

Tessera links them: **every piece of work has a conversation, and every conversation can have a piece of work.**

- Creating a card (a task or user story) creates its own chat.
- Creating a chat offers to create a card for it. Either side can also be added later.
- Every board has one general chat that is not tied to a card.
- Files attach to the card or message they belong to, so you find them by context.
- An optional AI assistant can summarise chats and answer questions about a project. It is **off by default**, only a project admin can turn it on, and it proposes changes for a person to approve.

Read [PROJECT.md](PROJECT.md) for the full vision, the first-version scope and the open questions. The draft data model is in [docs/data-model.md](docs/data-model.md), the web app design in [docs/web-app.md](docs/web-app.md), and the words we use in [CONTEXT.md](CONTEXT.md).

## Technology

TypeScript throughout:

| Part | Technology |
|---|---|
| API | [NestJS](https://nestjs.com/) |
| Web app | [React](https://react.dev/) with [Vite](https://vite.dev/) |
| Database | PostgreSQL with Prisma |
| File storage (planned) | MinIO |
| Packaging (planned) | Docker Compose, so you can host it yourself |
| Tests | [Vitest](https://vitest.dev/) and Testing Library |
| Linting and formatting | oxlint and Prettier |

## Repository layout

```text
apps/
  api/      NestJS back end
  web/      React front end
packages/
  shared/   Input rules shared by the API and the web app
docs/       Design documents
PROJECT.md  Vision, scope and decisions
CLAUDE.md   Rules for AI coding assistants
```

## Getting started

You need [Node.js](https://nodejs.org/) version 24 or newer (the exact version is in [.nvmrc](.nvmrc)) and Git.

You also need [Docker Desktop](https://www.docker.com/products/docker-desktop/), which runs the PostgreSQL database.

```powershell
git clone https://github.com/jongane/Tessera.git
cd Tessera
npm install
Copy-Item apps/api/.env.example apps/api/.env
docker compose up -d
npm run db:migrate -w apps/api
```

`docker compose up -d` starts PostgreSQL in the background. `docker compose down` stops it and keeps your data.

Then start each app in its own terminal:

```powershell
npm run start:dev -w apps/api   # API on http://localhost:3000
npm run dev -w apps/web         # Web app on http://localhost:5173
```

Open http://localhost:5173. The web app passes `/api` requests on to the API. Both reload when you save a file. Stop them with Ctrl+C.

To run it the way a server would, build both apps and start the API, which then also serves the web app on http://localhost:3000:

```powershell
npm run build -w apps/web
npm run build -w apps/api
npm run start:prod -w apps/api
```

`-w apps/api` means "run this script inside the `apps/api` workspace". All commands are run from the repository root.

## Common commands

| Task | API | Web app |
|---|---|---|
| Run tests | `npm test -w apps/api` | `npm test -w apps/web` |
| Run tests on every save | `npm run test:watch -w apps/api` | `npm run test:watch -w apps/web` |
| Database tests | `npm run test:db -w apps/api` | |
| End-to-end tests | `npm run test:e2e -w apps/api` | |
| Lint | `npm run lint -w apps/api` | `npm run lint -w apps/web` |
| Build | `npm run build -w apps/api` | `npm run build -w apps/web` |

## Contributing

Tessera is built in small, tested steps:

1. Create a branch from `main` (never commit to `main` directly).
2. Write a failing test, then the code that makes it pass.
3. Run the tests and the linter.
4. Commit with a [Conventional Commit](https://www.conventionalcommits.org/) message, such as `feat: add card linking` or `fix: ...`.
5. Open a pull request. Automated checks run lint, tests and build, and must pass before merging.

## Licence

[AGPL-3.0](LICENSE). If you run a modified version of Tessera as a service, you must share your changes under the same licence.
