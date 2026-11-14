# Files are stored through the S3 API, in SeaweedFS, and always pass through the API

Files attached to cards (and, in the next pull request, to messages) are kept in SeaweedFS, a file store that Docker Compose runs next to PostgreSQL. The API talks to it only through the S3 API, behind a small `FileStore` interface, and the browser never talks to it at all. We decided this on 2026-11-14, in the plan for roadmap step 3 (approved by the repository owner, decisions 1, 3 and 14). The details are in [api.md](../api.md) ("Files") and [data-model.md](../data-model.md) (the File table).

## Decision

- **SeaweedFS, not MinIO.** The project first planned MinIO. Its community edition is archived, so it would get no more fixes. SeaweedFS runs in `docker-compose.yml` and in CI, with an exact image version, its S3 port bound to `127.0.0.1` only, and its data in a named volume. The credentials in `docker/seaweedfs/s3.json` are for local development only, like the PostgreSQL password in the same file.
- **The S3 API is the contract.** The code uses the AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`). Any S3-compatible store (SeaweedFS, MinIO, Amazon S3 and others) works by changing the `S3_*` environment variables, with no code change.
- **A `FileStore` interface in front of it.** Everything that stores, reads or deletes a file's bytes calls three functions: `put(key, stream)`, `get(key)` and `delete(key)`. The S3 version (`S3FileStore`) is the only implementation for now. Tests can swap in a fake, and a version that keeps files in a folder on the server's own disk can be added later without touching the rest. Jon wants that as an option (agreed 2026-11-14); it is on the roadmap's after-the-MVP list.
- **Every byte goes through the API.** The storage is private. The API checks that the person is signed in and a member of the project before it passes any byte on, in both directions. Downloads and previews are streamed by the API at `/api/files/:fileId/download` and `/preview`, so they stay on the one address of [ADR 0001](0001-web-app-and-api-on-one-origin.md).
- **The API decides if a file is an image.** It reads the file's first bytes. Only a real PNG, JPEG, GIF or WebP is ever shown inline, and then with the matching type. The type the browser claims is never trusted. Every other file, SVG and HTML included, is only ever sent as a download (`application/octet-stream`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`). Otherwise a crafted file could run script with the signed-in person's cookie from the app's own address.
- **Random storage keys.** An object is stored as `files/<uuid>`, never under the file's name, so a name cannot point anywhere in the store.
- **The database row is the only way to an object.** A file is saved object first, then row; removed row first, then object. A crash between the two can leave an object nobody can reach (it wastes space but leaks nothing).

## Alternatives we did not choose

- **Keep MinIO.** It is the better-known name, but with its community edition archived we would be building on something that no longer gets fixes.
- **Let the browser upload to and download from the store directly (presigned links).** It saves the API some work with big files. But the storage would then be reachable from the browser, files would be served from another address (so ADR 0001 would no longer hold, and CORS would return), and the permission check would have to be repeated in the store's own rules. Going through the API keeps one copy of the rules.
- **Store files in PostgreSQL.** It is one less service to run, but large files make the database, its backups and its memory heavy.
- **Local disk first.** Simple for a single server, but a store behind the S3 API also covers bigger setups. Disk storage stays wanted, and the `FileStore` interface keeps the way open.

## Consequences

- `docker compose up -d` now starts SeaweedFS as well as PostgreSQL, and the API refuses to start if a storage setting is missing. Database, end-to-end and browser tests need both running, and CI starts SeaweedFS from the same compose file.
- A 100 MB upload is streamed, never held whole in the API's memory. It still has to finish inside Node's request time limit (5 minutes by default), so a very slow connection can fail.
- Deleting a board or a project (not built yet) must also delete the stored objects of its files. The database removes the rows, but only the API can remove objects.
- There is no clean-up job for orphaned objects yet.
