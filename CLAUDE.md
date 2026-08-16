# ITSM — CAP + SAPUI5 Service Desk App

Internal IT service management app for **ccentrik**, an SAP services company. Built with SAP CAP (Node.js, OData V4) + SAPUI5, originally in SAP Business Application Studio.

## Coding philosophy (follow these strictly)

- **CAP generic first.** Never hand-write SELECT/INSERT/UPDATE when CAP's generic CRUD already does it. Custom backend logic (`before`/`on` handlers in `srv/service.js`) only when genuinely required.
- **Explain before custom logic.** Before adding any custom backend handler, give a short WHAT/WHY/HOW/WHY-NOT-GENERIC-CAP explanation first, then the smallest implementation that solves it.
- **Data-driven UI5, not controller if/else.** Role/persona visibility and editability: Role → JSON Model (`webapp/model/roleConfig.js`) → XML binding. No `if (role === 'X')` chains in controllers or views.
- **Exactly three personas: END_USER, SERVICE_GROUP, CONSULTANT.** Never "Engineer" as a label.
- **One reusable ticket form** (`Main.view.xml`), not separate forms per persona — it adapts via `roleConfig.js`.
- **Minimal code, no speculative abstractions.** No new files/helpers/utilities unless there's a real, current need.
- **Very few comments, plain simple English.** Short sentences, common words, one idea per line. Only comment the *why*, never the *what*.
- **Schema (`db/schema.cds`) is source of truth.** Don't redesign it without being asked.
- User writes in Hinglish — match that register, don't switch to formal English.

## Architecture

- `db/schema.cds` — entities: `Ticket`, `IncidentForm` (composition of one), `Attachment` (composition of many), `TicketLog`, `LookupValue`, `TicketCounter`, `User` (has a `client` field for org/customer filtering), `OrganizationSLA`.
- `srv/service.cds` / `srv/service.js` — `ITSMService`, mostly generic projections. Custom handlers: ticket number generation (`before CREATE`), `assignedAt`/`completedAt` auto-stamping (`before UPDATE`), a deep-update workaround for `incidentForm.*` fields (see gotchas below), `currentUser()`/`getCurrUser()`.
- `app/webapp/` — 4 routed pages: `Dashboard` (ticket table, shared by END_USER/SERVICE_GROUP), `ServiceGroupDashboard` (analytics), `Main` (create/edit ticket form, shared by all personas), `AssignedTickets` (Consultant's queue).
- `app/webapp/model/roleConfig.js` — the persona → field visibility/editability table. Read this before touching any form field's behavior.
- `app/webapp/model/lookupValues.js` — shared `fetchLookup(oModel, sLookupType)` helper for dropdown data from `LookupValue`.
- Ticket number format: `INC-00001`, `SRV-00001`, `CHG-00001` (type prefix + 5-digit zero-padded sequence, per-type counter in `TicketCounter`).
- Status/priority codes are UPPERCASE strings (`DRAFT`, `NEW`, `IN_PROCESS`, ...; `CRITICAL`/`HIGH`/`MEDIUM`/`LOW`), always resolved to display names via `LookupValue`, never hardcoded label strings in the UI.

## Known UI5/CAP gotchas (don't rediscover these)

- **`onInit()` runs before the view is attached to the control tree.** Component/inherited models and `byId()`-found controls (e.g. chart `setVizProperties`) aren't reliably ready yet. Do that kind of setup in the route's `patternMatched` handler instead, guarded by a one-time flag.
- **OData v4 `binding.filter(aFilters)` is a no-op if the new filters equal the current ones** (e.g. reopening a page with nothing changed) — it won't refetch. Follow it with `binding.refresh()` if you need a guaranteed re-fetch.
- **`Context#delete(sGroupId)` / `Context#create()` only queue the request** on that batch group — nothing is sent until `oModel.submitBatch(sGroupId)` is called. Easy to forget on delete flows specifically (save/submit already do it).
- **Deep-updating a composition child** (`incidentForm.*` fields) via a flat relative path (`{incidentForm/system}`) sends the PATCH nested inside the parent ticket's body, without the child row's own key — CAP's generic handler silently drops it. Fixed in `srv/service.js`'s `before UPDATE Tickets` handler: it pulls `req.data.incidentForm` out and issues an explicit `UPDATE` against `IncidentForm` matched by `ticketID`. If you add new deep-updatable child fields, this already handles it — no per-field code needed.
- **`sap.viz` VizFrame charts inside a `$batch` request to a nav-relative path can 404** if the request isn't part of a properly declared changeset — test nav-relative filters/updates with a raw `curl` against the OData service before assuming a UI bug.
- **This app's `index.html` is hand-written, not CAP-generated** — `cds watch`'s LiveReload does not inject into it. Manual hard-refresh (Ctrl+Shift+R) is needed after any client-side (view/controller/CSS) change. Confirmed working as expected otherwise; not worth chasing further.

## Local dev

- Persistent file-based SQLite (`db/itsm.sqlite`), not `:memory:`. After any `schema.cds` or `db/data/*.csv` change, run:
  ```
  npx cds deploy --to sqlite:db/itsm.sqlite
  ```
  A plain server restart does **not** pick up schema/seed changes.
- **`cds deploy` fully rebuilds `Ticket`/`IncidentForm`/`Attachment`/`TicketCounter` from their CSVs** — any dummy ticket data created live via the API (not CSV) gets wiped every time. Re-seed after deploying (there's an established seed script pattern used this session — recreate tickets via API calls as `virat`/`dev`, then PATCH priority/team/assignment as `sachin`/`aayush`).
- Mocked auth users (`package.json`): `sachin`/`aayush`/`virat` are the original three (ServiceGroup/Consultant/EndUser). `sarthak`/`jatin`/`punit`/`dev` were added later (see below).
- Production profile uses HANA (`@cap-js/hana`) + XSUAA auth + an approuter (`app/router/`) for the login redirect — see `mta.yaml`.

## Working with a teammate on the same repo

**Aayush Porwal (aayush.porwal@ccentrik.com)** also commits to this repo independently via git, sometimes editing the same files (`package.json`, `db/schema.cds`, dummy CSV seed data) outside this chat session. This has caused real conflicts before:

- Aayush's dummy `Ticket.csv`/`IncidentForm.csv` use different conventions than this session's (`P1/P2/P3` priority instead of `CRITICAL/HIGH/MEDIUM/LOW`, `SD-L1`/`APP-SUP`/`NET-OPS` support teams instead of `SAP_FICO`/`SAP_MM_SD`/etc.). If `cds deploy` pulls in his CSVs, those tickets show up with unmapped/blank-colored priority and orphaned team codes until manually PATCHed to match this app's `LookupValue` codes.
- **Before running any local dev server** (`cds-serve`/`cds watch`), check `lsof -i :4004` first — a teammate's own `cds watch` may already be running and serving the team's shared dev port; killing it to start your own causes real disruption (happened once this session).
- **Before committing schema/config changes**, run `git status` / `git log` — check whether local is behind `origin/main`, since Aayush pushes independently. Rebase (not force-push) to reconcile; never `git commit --amend` a commit that's already been pushed (rewrites shared history — also happened once this session, had to be undone with `git reset --hard origin/main`).
- If asked to merge code someone else (a manager/teammate) pasted in: treat their paste as authoritative for what it explicitly contains, but **keep every existing field/entity/function that their paste doesn't mention** — don't delete working functionality just because a newer paste omitted it. Flag ambiguous overlaps (e.g. two fields that seem to serve the same purpose) instead of silently picking one.
