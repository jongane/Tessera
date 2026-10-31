# Rules for AI helpers working on Tessera

Read PROJECT.md first. It says what Tessera is, what it is not, and what is still undecided.
Use the words defined in CONTEXT.md, in code, docs and screens.

## About the owner
- New to TypeScript and GitHub; experienced in Visual Basic, C++ and C#.
- Explain unfamiliar concepts simply, including the "why". Diagrams help.
- On Windows 11 using PowerShell.
- If a requirement is ambiguous or a process is complicated, ask before building.
- Propose a plan and wait for approval before large changes.

## Checking for contradictions
This applies in design interviews and whenever the owner asks for a change, including in PR plans.
- Before writing a new answer or request down, check it against what is already decided: PROJECT.md, CONTEXT.md, the specs in `docs/` (such as card-features.md and web-app.md), the ADRs in `docs/adr/`, and earlier answers in the same conversation.
- If it contradicts any of these, say so straight away. Quote both statements and say where each one comes from (file and section, or "your answer to Q3").
- Ask which one wins. Do not pick one yourself, and do not write either one into a doc or code until the owner answers.
- Also flag a "possible conflict" when it quietly narrows or changes an earlier decision without clearly contradicting it.
- Once the owner decides, update every place that holds the old version in the same change, so the docs never disagree with each other.

## Stack
TypeScript (strict, ES modules), NestJS, React (Vite), PostgreSQL, Prisma, MinIO, Docker Compose.
Tests: Vitest (web tests also use jsdom and Testing Library). Linting: oxlint. Formatting: Prettier. Node version: see `.nvmrc`.
Monorepo: `apps/api`, `apps/web`, `packages/shared`, `docs/`.

## Workflow
- Work on a feature branch, never directly on `main`.
- Small commits with Conventional Commit messages (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Changes reach `main` through a pull request.
- CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint, tests (including database tests against PostgreSQL) and build for both apps on every pull request. Do not merge while it is red.
- Before opening a pull request, and before pushing new commits to an open one, run the `reviewer` agent (`.claude/agents/reviewer.md`) on the branch's changes. Fix every serious finding. List any minor findings you leave in the pull request description, with the reason.
- The "Claude review" check (`.github/workflows/claude-review.yml`) runs the same review on every push to a pull request. It fails when it finds something serious. Do not merge while it is red.

## Testing (test-driven development)
1. Write a failing test first.
2. Write the minimum code to pass it.
3. Refactor with tests green.
4. Run the whole test suite and the linter before saying a task is done.
- Any change to existing behaviour updates or adds tests in the same change.
- Web tests describe what a user sees (roles, visible text), not component internals.
- Report test results honestly. Never claim tests passed unless they were run.

## Code standards
- TypeScript strict mode. No `any` without a comment saying why.
- Validate all input at the API boundary, with the zod rules in `packages/shared`, so the web app can check forms with the same rules.
- Database changes go through Prisma migrations (`prisma/migrations`), never by editing tables by hand. Each table change comes with a database test (`*.db-spec.ts`) against a real PostgreSQL.
- Check permissions on every request: a user only sees projects they belong to.
- Never commit secrets (API keys, passwords, .env files). Hash passwords.
- Keep functions small and named for what they do.
- ES modules in `apps/api` and `packages/shared`: relative imports end in `.js` (e.g. `./app.service.js`), even though the source file is `.ts`. Node runs the compiled files and needs the full name.
- In `apps/web`, relative imports have no extension (e.g. `./AppShell`). Vite (and Playwright, for `e2e/`) finds the file itself.

## Domain rules (from PROJECT.md)
- A card has at most one thread. A thread may exist without a card, and the reverse.
- Each board has exactly one general thread that is not linked to a card.
- Use the word "thread", not "channel".
- Only a project admin can turn AI on or change AI settings.

## AI features
- Nothing is sent to an AI provider unless a project admin has enabled AI for that project. Default is off.
- All AI calls go through the provider layer, never directly from feature code.
- The AI proposes changes; a person approves them.

## Commands
Run from the repository root in PowerShell. `-w apps/api` means "run inside the api workspace".

| Task | Command |
|---|---|
| Install everything | `npm install` |
| Run API (auto-reload) | `npm run start:dev -w apps/api` |
| Unit tests (once) | `npm test -w apps/api` |
| Unit tests (watch) | `npm run test:watch -w apps/api` |
| Database tests | `npm run test:db -w apps/api` |
| End-to-end tests | `npm run test:e2e -w apps/api` |
| New database migration | `npm run db:migrate -w apps/api -- --name <what-changed>` |
| Browse the database | `npm run db:studio -w apps/api` |
| Test coverage | `npm run test:cov -w apps/api` |
| Lint | `npm run lint -w apps/api` |
| Format | `npm run format -w apps/api` |
| Build | `npm run build -w apps/api` |

Database and end-to-end tests need PostgreSQL running: `docker compose up -d` (from the repository root) and an `apps/api/.env` copied from `apps/api/.env.example`.

The API listens on http://localhost:3000. Stop a running server with Ctrl+C.

Web app (`apps/web`), same pattern:

| Task | Command |
|---|---|
| Run web app (auto-reload) | `npm run dev -w apps/web` |
| Tests (once) | `npm test -w apps/web` |
| Tests (watch) | `npm run test:watch -w apps/web` |
| Lint | `npm run lint -w apps/web` |
| Build (type-checks, then packages) | `npm run build -w apps/web` |
| Browser tests (Playwright) | `npm run test:browser -w apps/web` |

The web app listens on http://localhost:5173 and passes `/api` on to the API, so run both. Browser tests need PostgreSQL running and, once, `npx playwright install chromium` (from `apps/web`). They build everything and start the API on port 3100 against the test database.

In production the API also serves the built web app: `npm run build -w apps/web`, `npm run build -w apps/api`, then `npm run start:prod -w apps/api` (http://localhost:3000).

Shared input rules (`packages/shared`, imported as `@tessera/shared`), same pattern:

| Task | Command |
|---|---|
| Rebuild after changing it | `npm run build -w packages/shared` |
| Rebuild on every save | `npm run dev -w packages/shared` |
| Tests (once) | `npm test -w packages/shared` |
| Lint | `npm run lint -w packages/shared` |

`npm install` builds it automatically. The apps use the built copy, so after changing a rule, rebuild it before running the API or its tests.