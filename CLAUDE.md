# Rules for AI helpers working on Tessera

Read PROJECT.md first. It says what Tessera is, what it is not, and what is still undecided.

## About the owner
- New to TypeScript and GitHub; experienced in Visual Basic, C++ and C#.
- Explain unfamiliar concepts simply, including the "why". Diagrams help.
- On Windows 11 using PowerShell.
- If a requirement is ambiguous or a process is complicated, ask before building.
- Propose a plan and wait for approval before large changes.

## Stack
TypeScript (strict, ES modules), NestJS, React (Vite), PostgreSQL, Prisma, MinIO, Docker Compose.
Tests: Vitest (web tests also use jsdom and Testing Library). Linting: oxlint. Formatting: Prettier. Node version: see `.nvmrc`.
Monorepo: `apps/api`, `apps/web`, `packages/shared`, `docs/`.

## Workflow
- Work on a feature branch, never directly on `main`.
- Small commits with Conventional Commit messages (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- Changes reach `main` through a pull request.
- CI (GitHub Actions, `.github/workflows/ci.yml`) runs lint, tests and build for both apps on every pull request. Do not merge while it is red.

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
- Validate all input at the API boundary.
- Check permissions on every request: a user only sees projects they belong to.
- Never commit secrets (API keys, passwords, .env files). Hash passwords.
- Keep functions small and named for what they do.
- ES modules: relative imports in TypeScript files end in `.js` (e.g. `./app.service.js`), even though the source file is `.ts`.

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
| End-to-end tests | `npm run test:e2e -w apps/api` |
| Test coverage | `npm run test:cov -w apps/api` |
| Lint | `npm run lint -w apps/api` |
| Format | `npm run format -w apps/api` |
| Build | `npm run build -w apps/api` |

The API listens on http://localhost:3000. Stop a running server with Ctrl+C.

Web app (`apps/web`), same pattern:

| Task | Command |
|---|---|
| Run web app (auto-reload) | `npm run dev -w apps/web` |
| Tests (once) | `npm test -w apps/web` |
| Tests (watch) | `npm run test:watch -w apps/web` |
| Lint | `npm run lint -w apps/web` |
| Build (type-checks, then packages) | `npm run build -w apps/web` |

The web app listens on http://localhost:5173.