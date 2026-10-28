# Web API

The API is what the web app (and anything else) talks to. Every address starts with `/api`, and request and response bodies are JSON. When the API runs locally, it is at http://localhost:3000/api.

Status: accounts, sign-in and project members are built. Endpoints for projects, boards, cards, threads and the card features come next.

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
