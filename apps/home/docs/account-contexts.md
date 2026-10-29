# Account contexts (issue #3)

Each account has one `account-engine.ts` closure: its `WilmaClient`, sign-in lifetime,
read queue, single-flight sync/recovery, logout barrier and automatic-login backoff.
`engine.ts` keeps these engines by stable account identity. Its existing UI exports
delegate to the selected engine; `engineFor(account)` targets a source explicitly.
Selecting another account never changes an existing asynchronous operation's target.
A device reset cancels every owner and waits for all logouts before erasing storage.

`store.ts` gives each engine a stable store handle with its own generation, snapshot,
local marks, AI results, translations, session and login preferences. Handles from
before a reload/reset cannot publish into the replacement store. Supplying another
account's snapshot, session or sign-in to a context is rejected. Passwords and cookies
are never used as account identifiers. `AccountRef` includes both source account and
local item/pupil ID; equal IDs in different Wilmas are different references.

The normalized school URL and username keep the existing cache identity. CLI list
positions and pupil names are not identities. Desktop recovery finds the matching
CLI login by school/username, then reads its current profile ID. Browser development
also resolves that identity on the server before accessing a login, and checks the
returned identity before accepting its session.

Display preferences, AI provider keys, usage budget and phrase translations remain
device-wide. `staySignedIn`, `rememberPassword` and `wilmaPassword` belong to the
account. A password is persisted only after the complete login is accepted, including
MFA and fetching the pupils. As before, passwords are obfuscated in localStorage,
not encrypted; session cookies are in IndexedDB. Account isolation here is application
logic within one OS user's app storage, not a boundary against someone controlling
that OS account.

## Migration and persistence

The IndexedDB `accounts.v2` record has `version: 2`, the selected account ID and each
account's cached data, session, login flags and whether its cache is currently shown.
Passwords have separate localStorage keys under the corresponding account namespace;
they are excluded from the IndexedDB account record.

The v1 migration combines the former cache map with the active snapshot. Only the
original active account receives the old global session and login preferences/password.
It copies drafts, pupil filters and history to that account's existing namespace.
The v2 write commits before the global v1 data and password are retired. Repeating an
interrupted migration or cleanup is safe. A v2 sign-out cannot leave a global v1 cookie
that an older app could resume. Unknown storage versions are rejected without a write.

## Shared Home / CLI / MCP sessions

Both Rust Home and Node CLI use the same `wilmai-sessions.json.lock` directory, created
atomically with owner-only permissions. It covers the entire read/modify/write/rename,
including CLI removal/clear. Reads remain lock-free because writes use temporary files
and atomic rename. The existing JSON format, TTL, environment overrides and session
keys remain compatible. Windows resolves the profile from `USERPROFILE`, or
`HOMEDRIVE` + `HOMEPATH`, without requiring `HOME`.

All writers must use this updated protocol; an older running binary does not honor
the lock. A normal failure releases it. A killed process can leave a lock directory:
subsequent writers stop after five seconds rather than overwrite another writer's
state. Recovery requires closing all WilmAI programs and removing that directory.
The app never guesses that a slow writer is dead or steals its lock.

## Verification and remaining UI work

`test:accounts` covers overlapping IDs, separate cookies and passwords, late reads,
account-specific logout/session expiry, restart, migration, stale handles and reset
races. The existing auth regressions continue to run. The CLI test starts 24 separate
writers. Rust tests contend from multiple threads. With a built CLI and Rust installed,
`node scripts/test-session-lock-cross-language.mjs` starts four Node and four Rust
processes and verifies all 160 updates.

This stage keeps the current one-account UI projection. Adding an account without
signing out, polling every connected account and the unified Today view are issue #4.
Combined views, source-aware writes, AI processing and notifications are issue #5.
The data and runtime interfaces here support those stages without switching a global
client around an asynchronous operation.
