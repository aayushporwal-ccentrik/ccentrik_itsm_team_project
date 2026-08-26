# ITSM — Regression Testing & Environment Verification Guide

**Scope:** SAP CAP (Node.js) + SAPUI5 ITSM app, hybrid HANA Cloud profile, custom JWT auth.
**Audience:** anyone pulling this repo fresh and hitting "works on the other laptop, not mine."
**Companion doc:** [`CLAUDE.md`](../CLAUDE.md) — architecture, gotchas, and feature history. This
guide assumes that context; it doesn't repeat it except where a command needs a concrete value
(env var name, CF org, port number) from this project specifically.

> Golden rule for this repo: **assume environment before assuming code.** The same GitHub commit
> runs differently across two machines because of Node/CDS version drift, a stale `.env`, a stale
> CF login token, a `.cdsrc-private.json` binding that was never created on this machine, or a
> browser cache holding an old UI5 bundle — none of which show up in `git diff`. Work top-down
> through Phases 1→6 before touching application code.

---

## Phase 1 — Environment Comparison Checklist

Run every command below on **both** laptops and diff the output side by side.

| # | Check | Command (PowerShell) | What it verifies |
|---|---|---|---|
| 1 | Node.js version | `node -v` | CAP 9 / cds-dk 9 require a specific Node range (check `@sap/cds-dk` release notes — Node 18/20 LTS is the safe zone). A newer/older Node than the other laptop is the single most common "works there, not here" cause. |
| 2 | NPM version | `npm -v` | Mismatched npm can resolve `package-lock.json` differently, especially with peer-dependency changes between npm 8/9/10. |
| 3 | CDS CLI version | `cds -v` (shows both the global `@sap/cds-dk` and the local `@sap/cds` from `node_modules`) | This repo pins `@sap/cds@^9` and `@sap/cds-dk@^9` — a global `cds-dk` installed outside that range behaves differently for `cds watch`/`cds deploy`, sometimes silently. |
| 4 | Git branch | `git branch --show-current` | Confirms you're actually comparing the same branch — obvious, but frequently the real cause. |
| 5 | Git commit hash | `git rev-parse HEAD` | Confirms identical commit. If different, `git log --oneline -5` on both to see what's missing. |
| 6 | Local uncommitted state | `git status` | Untracked/modified files (especially `db/itsm.sqlite`, `.env`, `.cdsrc-private.json`) explain per-machine behavior that never shows in a diff against origin. |
| 7 | `package.json` diff | `git diff origin/main -- package.json` | Confirms no local edits to dependency ranges or the `cds.requires` block. |
| 8 | `package-lock.json` diff | `git diff origin/main -- package-lock.json` | A lockfile diff with no `package.json` diff usually means someone ran `npm install` with a different npm/Node and it silently rewrote resolved versions. |
| 9 | Installed vs. locked packages | `npm ls --depth=0` and `npm ci --dry-run` | Confirms `node_modules` actually matches the lockfile — a `git pull` doesn't touch `node_modules`, so a lockfile change since your last `npm install` leaves you running stale packages with no error. |
| 10 | `.env` presence & shape | `Test-Path .env` then `Get-Content .env \| Select-String '^\w+='` (prints **names only**, never values) | `.env` is gitignored (see [`.env.example`](../.env.example)). A missing `.env` means `JWT_SECRET` falls back to a random per-process secret — login "works" but every token dies on the next restart, which looks exactly like a flaky auth bug. |
| 11 | Required env vars set | Compare against `.env.example`: `JWT_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_TOKEN_EXPIRY`, `APP_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`MAIL_FROM` | `APP_URL` wrong (e.g. still `http://localhost:4004/webapp` when running on a different port) breaks password-setup/reset links. Missing SMTP vars aren't an error — the reset link just prints to the console instead — but if the other laptop *has* SMTP configured, that's a real functional difference in the auth flow, not a bug. |
| 12 | Cloud Foundry target | `cf target` | Shows API endpoint, org, space. **Must** read org `1383a27ftrial`, space `dev` for this project's hybrid profile — anything else means you're pointed at the wrong landscape. |
| 13 | CF login validity | `cf apps` (any non-auth-error output means the token is live) | A stale/expired CF OAuth token is a documented recurring failure mode for this project (see `CLAUDE.md` → *Connecting to real HANA*) — symptom is "HANA is running but no data comes through", or `cds bind --exec` failing with `token expired`. |
| 14 | HANA binding file | `Test-Path .cdsrc-private.json` | This file is **gitignored and per-machine** — a fresh clone never has it. If it's missing, hybrid profile (`cds watch --profile hybrid`) cannot resolve HANA credentials at all; you must run `cds bind` yourself (Phase 3). |
| 15 | OS / shell | `[Environment]::OSVersion` and `$PSVersionTable.PSVersion` | Path separators, case-sensitivity of file lookups, and line-ending handling (CRLF vs LF) differ between Windows/macOS/Linux and can matter for `.env` parsing or shell scripts committed by a teammate on a different OS. |
| 16 | Port already in use | `netstat -ano \| findstr :4004` then `Get-Process -Id <PID>` | This is a **shared dev port issue in this project specifically** — a teammate's own `cds watch` can already be bound to 4004. Check before starting your own server; killing someone else's process is disruptive (documented incident in `CLAUDE.md`). |
| 17 | Local SQLite file present & fresh | `Get-Item db\itsm.sqlite \| Select LastWriteTime` | If this file predates your last `git pull` that touched `db/schema.cds` or any `db/data/*.csv`, your local schema is stale — see Phase 3. |

**How to read the diff:** any row that differs between the two laptops is a *candidate root cause*,
not a confirmed one. Fix the environment rows first (Node/npm/cds versions, then `.env`, then CF/HANA
binding), rerun the specific failing flow, and only move to Phase 2+ if the symptom persists.

---

## Phase 2 — Clean Project Verification

Use this when Phase 1 didn't find an obvious version/config mismatch, or after fixing one, to
guarantee `node_modules` matches the lockfile exactly.

```powershell
# 1. Confirm nothing uncommitted would be lost first
git status

# 2. Remove local dependency state
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue   # only if you intend npm to re-resolve; see caveat below

# 3. Clear npm's cache (fixes corrupted cache entries, not a routine step)
npm cache clean --force

# 4. Reinstall exactly what's in the lockfile
#    npm ci is preferred over npm install here — it installs strictly from
#    package-lock.json and fails loudly on any mismatch, rather than
#    silently resolving new versions the way `npm install` can.
npm ci

# 5. Verify package integrity
npm ls --depth=0
npm audit signatures     # optional, confirms package integrity hashes

# 6. Rebuild / re-verify the CAP model compiles
npx cds compile srv/service.cds --to json > $null
if ($?) { "cds model compiles OK" }

# 7. Redeploy local SQLite from current schema + CSVs (see Phase 3 for why this is mandatory, not optional)
npx cds deploy --to sqlite:db/itsm.sqlite
```

**Caveat on step 2:** only delete `package-lock.json` if you actually want npm to re-resolve
dependency versions (e.g. you suspect the lockfile itself is corrupted). If the lockfile is fine
and you just want a clean `node_modules`, skip deleting it and run `npm ci` directly — that's the
whole point of `npm ci` over `npm install`.

### When *not* to use `git reset --hard`

- **Never** as a way to "clean up" a broken `node_modules` or `.env` — neither is tracked by git,
  so `reset --hard` won't touch them and you'll have discarded unrelated work for nothing.
- **Never** if `git status` shows uncommitted changes you haven't reviewed — `reset --hard`
  discards them permanently, no undo. Stash (`git stash -u`) first if in doubt.
- **Never** to "fix" a divergence from `origin/main` on this repo specifically — Aayush pushes to
  this repo independently outside this workflow (see `CLAUDE.md` → *Working with a teammate*).
  Rebase onto `origin/main`, don't discard local commits to force a clean match.
- **Only** reach for it when you are certain every local change is either already pushed or
  disposable (e.g. undoing a broken local experiment you never intend to keep), and you've
  confirmed that with `git status`/`git diff` first.

---

## Phase 3 — HANA & CAP Validation

This project's `[development]` profile always uses local SQLite regardless of whether HANA is up
(see `package.json`'s `cds.requires["[development]"].db`). You only touch HANA when deliberately
running the **hybrid** profile.

| Step | Command | Expected successful output | Failure symptom → likely cause |
|---|---|---|---|
| 1. Confirm CF login | `cf target` | `org: 1383a27ftrial`, `space: dev` | "No org targeted" → `cf login -a https://api.cf.us10-001.hana.ondemand.com` (add `--sso` if prompted), select org/space. |
| 2. Confirm services exist | `cf services` | Lists `ITSM-db` (HDI container) as `create succeeded` | Missing service → you're in the wrong space, or the instance was never provisioned on this landscape. |
| 3. Confirm service key | `cf service-key ITSM-db ITSM-db-key` | Returns JSON credentials block | `Service key not found` → `cf create-service-key ITSM-db ITSM-db-key`. |
| 4. Local binding exists | `Test-Path .cdsrc-private.json` | File exists, gitignored, per-machine | Missing → run `cds bind --to ITSM-db:ITSM-db-key` (or `cds bind --exec -- cds watch --profile hybrid` to bind and run in one step). Don't redo this if a teammate says it's already set up on their machine — it's per-machine by design. |
| 5. Binding resolves live creds | `cds bind --exec -- cf apps` | Runs without `token expired` | `Command failed: cf "oauth-token" ... token expired` → stale CF session, **not a CAP/schema problem**. Fix: `cf login -a https://api.cf.us10-001.hana.ondemand.com` again, reselect org/space, retry. This is a confirmed recurring cause for this project. |
| 6. Start hybrid profile | `cds watch --profile hybrid` | Log line `connect to db > hana` (not `sqlite`), server up on port 4004 | If log still says `sqlite`, you ran plain `cds watch`/`npm start` — those are hard-pinned to SQLite by `package.json`'s `[development]` override regardless of HANA state. |
| 7. Confirm DB migrations applied | Watch `cds watch --profile hybrid` boot log for deploy/migration lines, or run `cds deploy --to hana --profile hybrid --dry-run` | No pending delta / clean deploy | Pending schema delta → run `cds deploy --to hana --profile hybrid` (confirm with the user first if this is a shared HANA instance — see Phase-3 warning below). |
| 8. Seed data present | Query via OData: `curl http://localhost:4004/odata/v4/itsm/Users` (with a valid Bearer token) or a raw `SELECT` through `cf ssh`/HANA tools | Seeded users (`sachin`, `aayush`, `jatin`, `admin`, etc. — see `CLAUDE.md` → *Local dev*) come back | Empty result → CSVs never deployed to this HANA instance, or you're pointed at a different container than the other laptop. |
| 9. Service connectivity end-to-end | `curl -i http://localhost:4004/auth/login -H "Content-Type: application/json" -d "{\"email\":\"sachin@itsm.example.com\",\"password\":\"sachin123\"}"` | `200` with a JWT `token` in the body | `500`/`ECONNREFUSED` → server not actually up on that port, or DB connection failed at boot — check the CAP log (Phase 6) for the actual stack trace, don't guess. |

> ⚠️ **HANA schema changes are not automatically safe on this project.** `Organization` in
> particular gets fully wiped and reseeded from CSV whenever its table structure changes — this
> already happened once by accident (see `CLAUDE.md` → *Multi-Organization Admin Panel*). Before
> running `cds deploy --to hana`, confirm with whoever owns the shared HANA instance, and back up
> any live-only rows first.

For **local SQLite** (the default profile), the equivalent checklist is simpler and lower-risk:

```powershell
npx cds deploy --to sqlite:db/itsm.sqlite
```

Confirm success by the CLI printing `Creating database...` / `Populating...` for each entity with
no errors, then re-run Phase 1 step 17's `Get-Item` check to confirm the file's timestamp moved.
**Remember:** this fully rebuilds `Ticket`/`IncidentForm`/`Attachment`/`TicketCounter`/`Organization`
from their CSVs on *every* run, wiping any row created live via the API (not from a CSV) — re-seed
manually afterward if you had test data you need back.

---

## Phase 4 — Browser & UI5 Cache Validation

**Why UI5 cache causes inconsistent behavior specifically on this app:** `app/webapp/index.html`
is hand-written, not CAP-generated, so `cds watch`'s LiveReload does **not** inject into it (see
`CLAUDE.md` → *Known UI5/CAP gotchas*). A normal soft reload after a controller/view/CSS change can
silently keep serving the old bundle from browser cache, with no error anywhere — the app just
"looks like the old code," which is easy to mistake for a real regression.

| Step | How | Why it matters here |
|---|---|---|
| 1. Hard refresh | `Ctrl+Shift+R` (or `Ctrl+F5`) | The mandatory first step after **any** client-side change on this project — a plain refresh is not enough because of the hand-written `index.html`. |
| 2. Incognito/private window | Open the app fresh with no extensions, no existing cache/cookies | Isolates "my cache is stale" from "my browser profile has a leftover bad state" (old sessionStorage token, stale extension interference). |
| 3. Clear Local Storage | DevTools → Application → Local Storage → right-click origin → Clear | This app doesn't rely on LocalStorage for auth (see step 4), but stale entries from earlier experiments can still confuse `roleConfig.js`-driven UI state if anything was cached there. |
| 4. Clear Session Storage | DevTools → Application → Session Storage → Clear | **This is where the JWT lives** (`app/webapp/model/auth.js` holds the token in `sessionStorage`). A stale/expired token here causes silent 401s that look like a broken login flow rather than an expired session — always clear this when debugging auth issues specifically. |
| 5. Clear IndexedDB | DevTools → Application → IndexedDB → delete any UI5-created databases | UI5's OData V4 model can cache metadata/`$batch` state here across sessions; stale metadata after a schema change (new field, changed type) can cause binding errors that look like frontend bugs. |
| 6. Clear/unregister Service Workers | DevTools → Application → Service Workers → Unregister (if any are listed) | This app doesn't register one deliberately, but confirm none is present from an earlier experiment — a leftover service worker can serve cached responses indefinitely regardless of server changes. |
| 7. Confirm UI5 resource version | Network tab → filter `.js`/`.xml` → check response headers / URL for cache-busting | If the same file is served from `(disk cache)` after a hard refresh, DevTools → Network → check "Disable cache" while DevTools is open, then reload. |

---

## Phase 5 — Network & Console Investigation

Open Chrome DevTools (`F12`) before reproducing the issue, not after.

| Panel | What to check | How to identify root cause |
|---|---|---|
| **Console** | Any red error at page load or on the failing action | A JS exception *before* the OData call (e.g. `Cannot read properties of undefined`) points to a frontend binding/model bug — check whether it's the "aggregation bound to a never-set model" gotcha (`CLAUDE.md`), especially if it's a KPI tile or chart that's blank instead of showing `0`. |
| **Network — request list** | Every request the failing action triggers, in order | Compare the *set* of requests against what you'd expect (e.g. Submit should trigger a `PATCH` then a `ticketAction` bound action call, then a re-fetch). A missing request means the frontend never fired it — check the controller handler. An extra/duplicate request can indicate a double-bound event handler. |
| **Network — status codes** | `404`, `500`, `401`, `403` on any OData/`/auth/*` call | `401` → token missing/expired (check sessionStorage, Phase 4 step 4). `403` → role mismatch, check `_guardRoutes` in `Component.js` and the actual role on the JWT. `404` on an OData path → check for a typo'd navigation property or an entity not exposed in `service.cds`'s projection. `500` → **always** cross-reference with the CAP server log (Phase 6) for the actual stack trace; the browser only sees "Internal Server Error," not why. |
| **Network — request payload** | Click the failing request → Payload tab | For deep-update issues (`incidentForm.*` fields), confirm the PATCH body actually contains the child entity's key — if it's missing, you've hit the known CAP generic-handler gotcha, not a new bug. |
| **Network — response body** | Click the failing request → Response/Preview tab | CAP error responses include a structured `error.message` — read this before assuming a generic "something broke." |
| **Network — CORS errors** | Console shows `blocked by CORS policy`, Network shows the request as `(failed)` with no status | Only relevant if frontend and backend are served from different origins/ports — shouldn't happen in this app's normal `cds watch` setup (UI5 served from the same CAP server). If you see this, check you didn't accidentally start a second static server for `app/webapp` separately. |
| **`$batch` requests specifically** | Expand the batch request, check each changeset's individual status | VizFrame chart requests bundled into a `$batch` can 404 if the changeset isn't declared correctly — confirmed project gotcha. Isolate by re-running the same filter as a raw `curl` against the OData service directly (bypasses batching) to confirm whether it's a UI5 batching issue or a real backend bug. |

**Root-cause heuristic:** work backward from the last successful request to the first failing one.
If the failing request's payload/headers look correct but the server still errors, the bug is
backend (go to Phase 6). If the request never fires, or fires with a wrong/missing payload, the bug
is frontend (controller/model binding).

---

## Phase 6 — Backend Log Analysis

```powershell
# Local SQLite profile
cds watch

# Hybrid HANA profile
cds watch --profile hybrid
```

| Step | What to do | What it tells you |
|---|---|---|
| 1. Watch boot log | Confirm `[cds] - connect to db > sqlite` (or `> hana`), no errors, server line `app is running at http://localhost:4004` | Confirms which DB you're actually connected to — the #1 source of "works on the other laptop" is not realizing you're on a different DB than you think (see Phase 3, step 6). |
| 2. Reproduce the failing action | Trigger it from the browser while watching the terminal | CAP logs each request; a `500` in the browser should show a matching stack trace here in real time. |
| 3. Read the stack trace top-down | Find the first frame inside `srv/` (not inside `node_modules`) | That's your actual failure point. `srv/service.js`'s custom handlers (`onticketAction`, the deep-update `before UPDATE Tickets` handler, `sendReminder`, `currentUser`) are the most likely custom-code culprits per `CLAUDE.md`'s documented bug history — check those first if the trace touches them. |
| 4. Match frontend error to backend log by timestamp | Line up the Network tab's request timing with the terminal's request log line | Confirms you're looking at the log line for the *same* request, not a stale one from a previous action. |
| 5. Check for silent double-`module.exports` / duplicate `require` breakage | If the server fails to boot at all (not just one request failing), look for `SyntaxError` or a service that's missing all its custom handlers | Documented recurring failure mode on this project: a pasted code snippet with its own `module.exports` at file end silently replaces the real `cds.service.impl(...)`, taking every custom handler down with it, with no error until something that depends on a removed handler is called. |
| 6. Auth-specific tracing | If `500`s only happen post-login, check for `JWT_SECRET` issues: server log should NOT show a "using random per-process secret" style warning in production; in dev this is expected but means tokens die on every restart | Explains "I had to log in again" being much more frequent than expected — not a bug, just the dev fallback behavior when `.env` has no `JWT_SECRET`. |

---

## Phase 7 — Complete Manual Regression Test Suite

Conventions: **Test ID** format `<AREA>-<NUM>`. Run as each of the four personas where marked;
"All" means repeat identically for END_USER, SERVICE_GROUP, CONSULTANT, ADMIN unless noted.

### 7.1 Authentication

| Test ID | Precondition | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|---|
| AUTH-01 | Logged out, seeded user exists | Go to login route, enter valid email/password, submit | Redirected to persona's home route (`ROLE_ROUTES` in `auth.js`); JWT stored in sessionStorage | | ☐ |
| AUTH-02 | Same as above | Enter wrong password | Generic invalid-credentials error, no token issued | | ☐ |
| AUTH-03 | User `jatin` (multi-role: ADMIN+SERVICE_GROUP+CONSULTANT) | Log in with `jatin` | Token returned has `role: null`; app routes to role-selection screen, not a home page | | ☐ |
| AUTH-04 | Mid role-selection from AUTH-03 | Pick "Consultant" | `select-role` re-validates against `UserRole` table server-side; lands on Consultant home (`AssignedTickets`), no second password prompt | | ☐ |
| AUTH-05 | Logged in as any persona | Use header account popover → Switch Role (if multi-role) | Role switches without re-entering password; UI immediately reflects new persona's routes/fields | | ☐ |
| AUTH-06 | Logged in | Use header account popover → Logout | Full page reload (not SPA navigation) back to login; sessionStorage token cleared | | ☐ |
| AUTH-07 | Logged out | Try navigating directly to a deep link (e.g. `#/detail?...`) with no token | Bounced to `login` route, not shown the ticket | | ☐ |
| AUTH-08 | Logged out | "Forgot password" with a real registered email | Generic "if this email exists, a link was sent" message; console (no SMTP) or inbox (SMTP configured) shows the reset link | | ☐ |
| AUTH-09 | Same as above | "Forgot password" with a non-existent email | **Identical** generic message as AUTH-08 — no way to distinguish | | ☐ |
| AUTH-10 | Valid reset link from AUTH-08 | Open link, set new password | Password updated; reset token single-use — reusing the same link fails | | ☐ |
| AUTH-11 | Reset link older than 24h | Attempt to use it | Rejected as expired | | ☐ |
| AUTH-12 | ADMIN creates a new user via Admin panel | New user tries to log in before setting password | Cannot — must use the emailed setup link first (same mechanism as AUTH-10) | | ☐ |

### 7.2 Authorization / Route Guards

| Test ID | Precondition | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|---|
| AUTHZ-01 | Logged in as ADMIN | Try navigating to `#/dashboard`, `#/main`, `#/assignedTickets`, `#/detail` | Blocked/redirected — ADMIN has zero ticket-handling access | | ☐ |
| AUTHZ-02 | Logged in as END_USER/SERVICE_GROUP/CONSULTANT | Try navigating to `#/organizations` or `#/organizationDetail` | Blocked/redirected — those three personas never reach Admin routes | | ☐ |
| AUTHZ-03 | Any persona | Navigate to `#/detail?id=<valid ticket>` | Allowed — `detail` is open to everyone except ADMIN, per design | | ☐ |
| AUTHZ-04 | END_USER | Attempt to Assign/Resolve/Close a ticket via direct API call (not just hidden UI button) | Server-side rejects — button hiding is UI-only, `roleConfig.js` is not a security boundary; confirm the actual `ticketAction` handler enforces role, or flag as a gap if it doesn't | | ☐ |

### 7.3 Dashboard (END_USER / SERVICE_GROUP)

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| DASH-01 | Log in as END_USER with existing tickets | Ticket table loads with correct rows for that user only | | ☐ |
| DASH-02 | Log in as SERVICE_GROUP | Ticket table shows tickets across relevant clients, filterable by Organization | | ☐ |
| DASH-03 | Log in as END_USER with **zero** tickets | KPI tiles show `0`, not blank — regression-tests the documented "unset model" gotcha fix | | ☐ |
| DASH-04 | Simulate a slow/failing backend (throttle Network to "Offline" briefly) | KPI tiles fall back to `0`/default shape via `.catch()`, not blank | | ☐ |
| DASH-05 | Any persona with access | Sidebar navigation reaches every route valid for that persona | | ☐ |
| DASH-06 | Ticket exists with a pending reminder-eligible state | Notification/reminder bell visible and reflects real cooldown state on load (`reminderStatus`), not only after a failed click | | ☐ |
| DASH-07 | ServiceGroupDashboard: charts | Donut/trend charts render with real data, no VizFrame batch errors in Network tab | | ☐ |

### 7.4 Ticket Management

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| TCK-01 | END_USER: Create Incident, fill required fields, Save (not Submit) | Ticket saved as `DRAFT`, ticket number **not yet** assigned (assigned on first CREATE — confirm actual behavior against `before CREATE` handler) | | ☐ |
| TCK-02 | Submit a Draft ticket | Ticket number generated in correct format (`INC-00001`/`SRV-00001`/`CHG-00001`), status moves off `DRAFT`, `TicketLog` gets an Initiator-stage row | | ☐ |
| TCK-03 | Submit with a required field missing | Client-side validation blocks submit with a clear message; no partial server write | | ☐ |
| TCK-04 | Edit an existing ticket's `incidentForm.*` field (e.g. `system`), Save | PATCH persists correctly — regression-tests the deep-update composition-child gotcha | | ☐ |
| TCK-05 | SERVICE_GROUP: Assign a `NEW` ticket to a Consultant | Status → `ASSIGNED`, `pendingWith`/`pendingWithName` update, `TicketLog` gets a Service Group-stage row, `assignedAt` auto-stamped | | ☐ |
| TCK-06 | CONSULTANT: Resolve an `ASSIGNED` ticket assigned to them | Status → `RESOLVED`, `completedAt` auto-stamped, `TicketLog` gets a Resolved-stage row | | ☐ |
| TCK-07 | Close a `RESOLVED` ticket | Status → `CLOSED`; Close button no longer visible on reload (`roleConfig.js` gating by status) | | ☐ |
| TCK-08 | Attempt Assign on a ticket not in `NEW` status | Assign button not shown (per `roleConfig.js` `showAssign` gating) | | ☐ |
| TCK-09 | Reload any ticket mid-flow | Status/`pendingWith`/all fields reflect latest server state (`_loadTicket` re-fetch after every action) | | ☐ |

### 7.5 Attachments

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| ATT-01 | Upload a single file to a ticket | File appears in attachment list immediately after upload completes | | ☐ |
| ATT-02 | Upload multiple files in sequence | All files listed, none overwrite each other | | ☐ |
| ATT-03 | Download an attached file | File downloads intact, correct filename/content | | ☐ |
| ATT-04 | Upload an unusually large file | Graceful error if over any size limit, not a silent failure | | ☐ |

### 7.6 Comments / Timeline

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| CMT-01 | Add a comment to an active ticket | Appears in timeline immediately, correct author/timestamp | | ☐ |
| CMT-02 | Edit an existing comment (if supported) | Edit reflected, timeline order/timestamps still sensible | | ☐ |
| CMT-03 | Full lifecycle ticket (Submit→Assign→Resolve→Close) | Timeline shows all 4 fixed stages (Initiator, Service Group, Consultant, Resolved) in correct order with correct actors | | ☐ |

### 7.7 Email Flow

> Per `CLAUDE.md`: actual `sendMail` calls in `service.js` are currently commented out
> (`// TODO`). Test the flows that **are** live — auth emails and reminders — and explicitly mark
> the ticket-lifecycle emails as "not implemented yet," not as a bug.

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| MAIL-01 | Trigger password setup (Admin creates user) with SMTP configured | Real email received with working setup link | | ☐ |
| MAIL-02 | Same, without SMTP configured | Link printed to server console instead, no crash | | ☐ |
| MAIL-03 | `sendReminder` on an eligible ticket | Recipient resolved correctly per `getPendingRecipient` mapping (Service Group → all active SERVICE_GROUP users; Consultant → `messageProcessor`; Agent → `reportedBy`) | | ☐ |
| MAIL-04 | `sendReminder` called again before cooldown elapses | Blocked/no-op per `reminderCooldown`, bell reflects this via `reminderStatus` | | ☐ |
| MAIL-05 (N/A today) | Ticket status change (Submit/Assign/Resolve/Close) | *Not implemented* — confirm no email is expected yet, don't file as a bug | — | ☐ N/A |

### 7.8 Search & Filters

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| SRCH-01 | Free-text search on Dashboard | Matches expected tickets by number/subject | | ☐ |
| SRCH-02 | Filter by Priority | Only matching-priority tickets shown | | ☐ |
| SRCH-03 | Filter by Status | Only matching-status tickets shown | | ☐ |
| SRCH-04 | Filter by Organization (client) | Reads from `/Organizations` directly, not a stale `CLIENT` lookup list | | ☐ |
| SRCH-05 | Reset filters | Table returns to unfiltered full list — regression-tests the OData v4 "filter no-op when unchanged" gotcha; if reset re-applies an identical filter, confirm `binding.refresh()` was called, not just `filter()` | | ☐ |

### 7.9 Analytics (ServiceGroupDashboard)

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| ANLY-01 | Load donut chart(s) | Segments match actual ticket counts by status/priority | | ☐ |
| ANLY-02 | Load trend chart(s) | Time-series matches actual ticket creation dates | | ☐ |
| ANLY-03 | Cross-check any displayed count against a raw OData `$count` query | Numbers match exactly | | ☐ |

### 7.10 Multi-Org Admin / Theming

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| ADM-01 | ADMIN creates a new Organization | Appears in Organizations list; new user under that org resolves theme correctly | | ☐ |
| ADM-02 | Set a Primary/Secondary color and `GRADIENT` themeType | END_USER of that org sees `--brand-bg` gradient on login; header buttons stay flat colors (never inherit the gradient) | | ☐ |
| ADM-03 | Enter an invalid hex value in a color Input | Rejected before reaching any `style` property or CSS injection point (regex `^#[0-9a-fA-F]{3,8}$`) | | ☐ |
| ADM-04 | User with no org theme, or SERVICE_GROUP/CONSULTANT/ADMIN | Sees original navy default (`#021a86` fallback), unchanged | | ☐ |
| ADM-05 | Set New-Ticket button color and Form-action button colors independently | Each applies only to its own button group; Delete defaults red (`dangerBtn`) when unset | | ☐ |

### 7.11 Workzone / Navigation / Deep Links

| Test ID | Steps | Expected Result | Actual | Pass/Fail |
|---|---|---|---|---|
| NAV-01 | Load app with a headerless URL param (if applicable to deployment) | Renders without the standard shell chrome, functions identically otherwise | | ☐ |
| NAV-02 | Deep link directly to a specific ticket while logged in | Loads that ticket, correct persona-based field visibility | | ☐ |
| NAV-03 | Deep link while logged out | Bounced to login, then (if the app supports return-to-target) lands back on the original deep link after auth | | ☐ |
| NAV-04 | Browser back/forward through several routes | Route guards re-evaluate correctly each time, no stale persona state | | ☐ |

---

## Phase 8 — Working Laptop Comparison Matrix

Fill this in with actual values from both machines when isolating a "works there, not here" issue.

| Dimension | Laptop A (working) | Laptop B (broken) | Match? |
|---|---|---|---|
| `node -v` | | | ☐ |
| `npm -v` | | | ☐ |
| `cds -v` (global + local) | | | ☐ |
| `git rev-parse HEAD` | | | ☐ |
| `git status` (clean?) | | | ☐ |
| `.env` present, all required keys set (names only) | | | ☐ |
| `cf target` (org/space) | | | ☐ |
| `.cdsrc-private.json` present | | | ☐ |
| DB profile actually connected to (SQLite path / HANA) | | | ☐ |
| Browser + version | | | ☐ |
| Console errors on the failing action (paste exact text) | | | ☐ |
| Failing request's status code + response body | | | ☐ |
| `npm ls --depth=0` output diff | | | ☐ |

**How to isolate the difference:** change one variable at a time on the broken laptop, starting
with the row most likely to matter for the specific symptom (auth issue → `.env`/`JWT_SECRET`
first; data issue → DB profile/binding first; UI issue → browser cache first), and re-test after
each change. Don't change multiple rows at once — you'll fix it but never learn which one mattered,
and the same issue will resurface on a third machine.

---

## Phase 9 — Root Cause Decision Tree

```
"Application works on another laptop but not mine"
│
├─ Does `npm ci` complete with no errors, and does `npm ls --depth=0`
│  match the other laptop with no warnings?
│  ├─ NO → DEPENDENCY ISSUE
│  │       Fix: Phase 2 clean reinstall. If a specific package still
│  │       fails, check Node version compatibility (`node -v` vs the
│  │       package's engines field).
│  └─ YES ↓
│
├─ Does the failing behavior disappear in an Incognito window after
│  a hard refresh (Ctrl+Shift+R)?
│  ├─ YES → CACHE ISSUE
│  │        Fix: Phase 4 in full — SessionStorage in particular, since
│  │        that's where this app's JWT lives.
│  └─ NO ↓
│
├─ Does `cds watch` boot log show `connect to db > sqlite` when you
│  expected HANA, or vice versa?
│  ├─ MISMATCH → DATABASE PROFILE ISSUE
│  │             Fix: confirm which command you actually ran
│  │             (`cds watch` = always SQLite here; `cds watch
│  │             --profile hybrid` = HANA). Not a bug, a wrong command.
│  └─ MATCHES EXPECTATION ↓
│
├─ (Hybrid profile only) Does `cds bind --exec -- cf apps` run without
│  a `token expired` error?
│  ├─ NO → CLOUD FOUNDRY / CF SESSION ISSUE
│  │       Fix: `cf login -a https://api.cf.us10-001.hana.ondemand.com`,
│  │       reselect org `1383a27ftrial` / space `dev`, retry.
│  └─ YES ↓
│
├─ (Hybrid profile only) Does `.cdsrc-private.json` exist and does
│  `cf services` show `ITSM-db` as `create succeeded`?
│  ├─ NO → HANA BINDING ISSUE
│  │       Fix: Phase 3, steps 2-4 — create/rebind the service key.
│  └─ YES ↓
│
├─ Does `Get-Content .env | Select-String '^\w+='` show every key from
│  `.env.example` present, and is `db\itsm.sqlite` newer than the last
│  `schema.cds`/CSV change (`git log -1 -- db/schema.cds`)?
│  ├─ NO (missing env var) → ENVIRONMENT VARIABLE ISSUE
│  │       Fix: copy the missing value from `.env.example`/teammate,
│  │       restart the server (env is read at boot only).
│  ├─ NO (stale sqlite) → DATABASE SCHEMA/SEED ISSUE
│  │       Fix: `npx cds deploy --to sqlite:db/itsm.sqlite`, re-seed
│  │       any API-created test data afterward.
│  └─ YES ↓
│
├─ Is `git rev-parse HEAD` identical to the working laptop, and
│  `git status` clean?
│  ├─ NO → GIT MISMATCH
│  │       Fix: `git fetch`, compare `git log --oneline HEAD..origin/main`,
│  │       pull/rebase to match. Never force-push to reconcile.
│  └─ YES ↓
│
└─ Does the specific failing request show a clean 200 when replayed
   directly with `curl` (bypassing the UI5 `$batch` wrapper)?
   ├─ YES (curl works, UI fails) → ODATA/FRONTEND BATCHING ISSUE
   │       Fix: Phase 5's `$batch` guidance — inspect the changeset,
   │       check for the VizFrame nav-relative-path 404 gotcha.
   └─ NO (curl also fails) → BACKEND ISSUE, NOT ENVIRONMENT
           Fix: Phase 6 — read the CAP stack trace, this is now a real
           code bug, go debug `srv/service.js`/`srv/auth.js` directly.
```

---

## Bonus: 10-Minute Diagnostic Script

A runnable script that gathers everything from Phase 1 + Phase 3 (steps 1-3) into one place before
asking a teammate for help. See [`scripts/diagnose.ps1`](../scripts/diagnose.ps1) — run it and
paste its full output (it does not print secret *values*, only whether required keys are set).

```powershell
.\scripts\diagnose.ps1
```

## Bonus: Daily Regression Checklist (post-`git pull`, pre-release)

Quick pass, not the full Phase 7 suite — run this every time you pull new code before starting real
work, or before a release:

- [ ] `git log -1` — confirm you're on the commit you think you're on
- [ ] `npm ci` if `package-lock.json` changed since your last pull
- [ ] `npx cds deploy --to sqlite:db/itsm.sqlite` if `db/schema.cds` or any `db/data/*.csv` changed
- [ ] Log in as one user per persona (END_USER, SERVICE_GROUP, CONSULTANT, ADMIN) — AUTH-01, AUTHZ-01/02
- [ ] Create + Submit one ticket end to end — TCK-01, TCK-02
- [ ] Run it through Assign → Resolve → Close once — TCK-05, TCK-06, TCK-07
- [ ] Dashboard KPI tiles show real numbers, not blank — DASH-03
- [ ] No red errors in DevTools Console on any of the above
- [ ] Hard refresh once before concluding anything is broken (Phase 4, step 1)

## Bonus: Printable QA Checklist

Print-friendly copies of Phase 7's tables and the daily checklist above are in the companion
artifact page — open it, use your browser's Print (`Ctrl+P`), and the print stylesheet collapses
navigation chrome and keeps only the checklists/tables.
