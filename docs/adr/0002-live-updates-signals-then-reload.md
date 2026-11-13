# Live updates send signals, and the browser then reloads

The web app keeps screens current with a live connection that carries only "something changed" signals, such as "card WEB-12 on this board changed" or "the chat list changed". The browser then reloads just that piece through the normal API. We decided this on 2026-11-13 (plan approved by the repository owner, question 1 and question 4) instead of sending the changed data itself over the connection. The details are in [api.md](../api.md) ("Live updates") and [web-app.md](../web-app.md) section 6.

## Decision

- **Signals, then reload.** A signal names what changed (a card, the board, the chat list or a message) and nothing else: no text, no names. The browser reloads the named piece with the same endpoints it already uses.
- **Socket.IO** is the library, at `/socket.io` on the same address as the API ([ADR 0001](0001-web-app-and-api-on-one-origin.md)), so the session cookie is sent with the connection and checked when it is made. The server refuses a connection that is not signed in.
- **Rooms per board.** A tab joins the room of the board it is showing, and only if it is a member of that board's project. Someone removed from the project leaves the room at once.
- **One server for the MVP.** Signals are sent from memory inside the single API process. Several servers would need Redis (Socket.IO's Redis adapter) so that a signal reaches tabs connected to another server. We leave that until it is needed.
- **Nothing private over the socket.** Because only an id travels, there is nothing to leak if a connection is wrongly joined: the worst case is an extra reload that the normal permission checks answer.
- **One copy of the permission rules.** Every reload is an ordinary request, so it passes the same checks as any other. We write no second set of rules for the live connection.
- **Your own signals are ignored.** Each save carries the tab's connection id (`X-Live-Connection`). The server checks that it names a live connection of the same signed-in session, and only then puts it in the signal's `by`; otherwise `by` is null, so a made-up id can never reach a signal or hide a change from someone else.

## Alternatives we did not choose

- **Send the changed data itself in each live message.** It is a little faster, because the browser skips a request. But each kind of change would need its own data shape, and its own permission rules on the live connection (who may see this card's description, this private chat), kept in step with the API's. A mistake would leak data. The signal approach reuses what is already built and tested.
- **Keep reloading on a timer** (the 30-second reload). It is simple, but changes arrive late and every open tab keeps asking the server even when nothing changed.

## Consequences

- Each change costs one extra request per viewing tab, to reload what the signal names. That is fine at the size of a team.
- Adding a new kind of live change means adding a signal for it and telling the browser what to reload. No data shapes or permission rules are needed.
- A signal can arrive while a person is editing the same field. The app never overwrites what they are typing; it shows their text and the new version side by side ([web-app.md](../web-app.md) section 6).
- Signals are lost while a connection is down. The app catches up by reloading the board, the open card, the chat list and the open chat once the connection is back.
- Going beyond one server later needs Redis, which is a new thing to run and watch.
