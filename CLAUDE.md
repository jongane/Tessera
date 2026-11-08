# Rules for AI helpers working on Tessera

Read PROJECT.md first. It says what Tessera is, what it is not, and what is still undecided.
Use the words defined in CONTEXT.md, in code, docs and screens.

## About the repository owner
The repository owner is the person who owns this GitHub repository and makes its design decisions. This is not the same as a card's Owner (see CONTEXT.md).
- New to TypeScript and GitHub; experienced in Visual Basic, C++ and C#.
- Explain unfamiliar concepts simply, including the "why". Diagrams help.
- On Windows 11 using PowerShell.
- If a requirement is ambiguous or a process is complicated, ask before building.
- Propose a plan and wait for approval before large changes.

## Checking for contradictions
This applies in design interviews and whenever the repository owner asks for a change, including in PR plans.
- Before writing a new answer or request down, check it against what is already decided: PROJECT.md, CONTEXT.md, the specs in `docs/` (such as card-features.md and web-app.md), the ADRs in `docs/adr/`, and earlier answers in the same conversation.
- If it contradicts any of these, say so straight away. Quote both statements and say where each one comes from (file and section, or "your answer to Q3").
- Ask which one wins. Do not pick one yourself, and do not write either one into a doc or code until the repository owner answers.
- Also flag a "possible conflict" when it quietly narrows or changes an earlier decision without clearly contradicting it.
- Once the repository owner decides, update every place that holds the old version in the same change, so the docs never disagree with each other.

## Stack
TypeScript (strict, ES modules), NestJS, React (Vite), PostgreSQL, Prisma, MinIO, Docker Compose.
Tests: Vitest (web tests also use jsdom and Testing Library). Linting: oxlint. Formatting: Prettier. Node version: see `.nvmrc`.
Monorepo: `apps/api`, `apps/web`, `packages/shared`, `docs/`.

## Workflow
- Work on a feature branch, never directly on `main`.
- Small commits with Conventional Commit messages (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Changes reach `main` through a pull request.
- CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint, tests (including database tests against PostgreSQL) and build for both apps on every pull request. Do not merge while it is red.
- Build every change with the sub agents in the order under "Sub agents" below.
- Before opening a pull request, and before pushing new commits to an open one, run the `reviewer` and `antagonist` agents on the branch's changes (docs-only changes need only the `reviewer`, see below). Fix every serious finding and every break the antagonist marks as blocking. List any other findings or proven breaks you leave in the pull request description, with the reason.
- The "Claude review" check (`.github/workflows/claude-review.yml`) runs the same review as the `reviewer` agent on every push to a pull request. It does not run the `antagonist`, which runs only on the developer's machine. It fails when it finds something serious. Do not merge while it is red.

## Who decides
- The repository owner makes every design choice: what a user sees, names, rules, data shapes, libraries and trade-offs.
- If the request, the plan or the docs do not make the direction clear, stop and ask the repository owner. Do not guess and carry on. This applies to the main helper and to every sub agent.
- Sub agents cannot ask the repository owner directly. They return their questions under **Questions**, and the main helper passes them on, at most five at a time, and waits for the answers.

## Sub agents
The agents live in `.claude/agents/`. Sub agents cannot call each other, so the main helper runs them in this order. `docs/agents.md` explains why, with a diagram.

| Step | Agent | Model | What it does |
|---|---|---|---|
| 1 | `planner` | Opus | Writes the plan with numbered acceptance criteria, checks it for contradictions, lists questions. |
| 2 | (repository owner) | | Answers the questions and approves the plan. Nothing is built before this. |
| 3 | `tester` (red) | Sonnet | Writes a failing test for every acceptance criterion and commits them on their own. |
| 4 | `builder` | Sonnet | Writes the least code that makes those tests pass. Never edits tests. |
| 5 | `tester` (verify) | Sonnet | Runs every test, the linter and the build, and reports honestly. |
| 6 | `docs-keeper` | Sonnet | Brings `docs/`, `CONTEXT.md`, ADRs and the commands tables in step with the code. |
| 7 | `reviewer` and `antagonist`, together | Opus | Reviewer checks the rules; antagonist attacks the change and proves each break with a failing test. |
| 8 | main helper | | Sends fixes back through `builder`, `tester` (verify) and, if behaviour changed, `docs-keeper`, then repeats step 7. Opens the pull request once both say `PASS`. |

Rules for running them:
- Any agent's **Questions** go to the repository owner before the next step. Do not answer them yourself.
- After every `builder` run, check it did not touch a test: `git diff <latest test: commit>..HEAD --stat` and `git status --porcelain` must list no test files (see `builder.md` for the list). If they do, undo those edits and send the builder's reason to the `tester`.
- A test change the builder asks for goes to the `tester`. If the plan does not settle it, ask the repository owner.
- The antagonist's `BLOCK` stops the pull request just like a serious reviewer finding. If it is unclear how to fix a break, or whether a design objection stands, ask the repository owner.
- The reviewer only reads committed changes, so the antagonist's uncommitted proof tests do not affect it when both run together.
- The antagonist's proof tests that show a real break are kept as regression tests: the `tester` commits them.
- Small changes that touch no code (docs only, a typo) may skip steps 1 to 6 and the antagonist, but still go through the `reviewer`.

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
- Start every text field in `packages/shared` from `textWithoutNul()`, not `z.string()`. It refuses the invisible NUL character with the app's message; the API refuses one anywhere in a request too (`docs/api.md`).
- Database changes go through Prisma migrations (`prisma/migrations`), never by editing tables by hand. Each table change comes with a database test (`*.db-spec.ts`) against a real PostgreSQL.
- Check permissions on every request: a user only sees projects they belong to.
- Never commit secrets (API keys, passwords, .env files). Hash passwords.
- Keep functions small and named for what they do.
- ES modules in `apps/api` and `packages/shared`: relative imports end in `.js` (e.g. `./app.service.js`), even though the source file is `.ts`. Node runs the compiled files and needs the full name.
- In `apps/web`, relative imports have no extension (e.g. `./AppShell`). Vite (and Playwright, for `e2e/`) finds the file itself.

## Domain rules (from PROJECT.md)
- A card has at most one chat of its own. A chat may exist without a card, and the reverse.
- Each board has exactly one general chat that is not linked to a card.
- A conversation is a "chat", never a "channel". A "thread" is only the replies to one message (CONTEXT.md).
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