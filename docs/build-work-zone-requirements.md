# SAP Build Work Zone Integration Requirements

What this project's architecture (CAP backend + SAPUI5 frontend, deployed to BTP Cloud Foundry, exposed through Work Zone via the managed App Router and HTML5 Application Repository) actually needs. Based on this project's own `mta.yaml`/`manifest.json`/`xs-app.json` and issues verified during deployment — not generic SAP documentation.

Each item is marked **Required**, **Recommended**, or **Not required**.

---

## 1. Deployment components (`mta.yaml` modules)

- **Required** — CAP backend as a `nodejs` module (this project: `ITSM-srv`), providing `srv-api` for other modules to reference its URL.
- **Required** — DB deployer (`hdb` module, `ITSM-db-deployer`) to load schema/seed data into HANA.
- **Required** — A `html5` type module wrapping the UI5 app folder (this project: `ITSM-ui`, `path: app/webapp`), building a zip containing the app's static content.
- **Required** — A `com.sap.application.content` module that requires the HTML5 repo host with `content-target: true`, to push the zip into HTML5 Application Repository (this project: `ITSM-app-deployer`).
- **Required** — A second `com.sap.application.content` module that requires the destination service with `content-target: true`, to register the destinations Work Zone needs to discover the app (this project: `ITSM-destinationcontent`). Without this, Work Zone's HTML5 Apps content channel finds zero apps even though the content upload itself succeeds.
- **Not required** — A standalone `approuter.nodejs` module. Verified in this project: removed entirely (module + its own npm project under `app/router/`) with no loss of functionality, since Work Zone's own managed router (via the `html5-apps-repo` `app-runtime` plan) serves the app. Keeping one deployed alongside a Work-Zone-only setup only adds a redundant, unused CF application.

---

## 2. HTML5 Application Repository requirements

- **Required** — `html5-apps-repo` service instance, plan `app-host` (this project: `ITSM-html5-repo-host`). Stores the actual app content.
- **Required** — `html5-apps-repo` service instance, plan `app-runtime` (this project: `ITSM-html5-runtime`). What the managed router reads through at request time.
- **Required** — The built zip must have `manifest.json`, the UI5 root files (`Component.js`, `index.html`), and `xs-app.json` at its root — confirmed via `cf html5-list <app> <version> <app_host_id>` in this project, which lists paths like `/itsmui-1.0.0/Component.js`.

---

## 3. `mta.yaml` configuration requirements

- **Required** — `parameters.deploy_mode: html5-repo` at the top level.
- **Required** — The destination-content module's registered `sap.cloud.service` value must **exactly match** `manifest.json`'s `sap.cloud`.`service` value. Verified root cause of a 404 on `Component.js`/`manifest.json` in this project when these two drifted apart (see `btp-troubleshooting-log.md`).
- **Required to understand** — A module's `provides:` name (e.g. `srv-api`) is an MTA build-time linking alias, not the same as the actual Destination `Name` registered in the Destination service. `xs-app.json`'s `"destination"` field must reference the real registered Destination `Name` (verified in this project: `srv-api` as a destination name did not exist; the real one was `ITSM-srv`, created via the `destination` resource's `init_data`).

---

## 4. Managed App Router considerations

- **Not required** — A dedicated/standalone App Router module. Work Zone's managed router serves HTML5-repo content directly.
- **Required** — The app's own `xs-app.json`, bundled inside the deployed zip (not a separate top-level MTA module). This is what the managed router consults for this specific app's own routing when serving it. Verified present at `app/webapp/xs-app.json` in this project and confirmed deployed via `cf html5-get`.
- **Required** — That bundled `xs-app.json` needs at minimum: a route for backend OData calls (`/odata/*` → the real backend Destination `Name`) and a catch-all route (`service: html5-apps-repo-rt`) to serve the app's own static files.

---

## 5. Destination configuration

- **Required** — A `destination` service instance, plan `lite` (this project: `ITSM-destination`).
- **Required** — A backend destination pointing at the CAP service's CF route, with `Authentication: NoAuthentication`, `HTML5.ForwardAuthToken: true`, `HTML5.DynamicDestination: true` (forwards the logged-in user's own token to the backend rather than the destination authenticating itself).
- **Required** — Content destinations for the HTML5 repo (`ITSM-html5-repository`, pointing at the `app-host` service key) and for XSUAA token exchange (`<xsappname>-uaa`, `Authentication: OAuth2UserTokenExchange`), both carrying the same `sap.cloud.service` value as `manifest.json`.
- **Situational, not required in this project** — A `ui5` destination proxying `https://ui5.sap.com`. Only needed if the app's `index.html` loads `sap-ui-core.js` through the approuter's `/resources/*` route. This project's `index.html` bootstraps directly from the public UI5 CDN URL, so it doesn't use this destination.

---

## 6. Authentication/authorization configuration

- **Required** — `xs-security.json` scopes and role-templates matching exactly what the backend checks via `req.user.is(...)` (case-sensitive).
- **Required** — Role Collections created in BTP Cockpit, each mapping one role template to real users.
- **Required, verified this session** — Role Collection user assignments must be made under the same Identity Provider/origin that the user actually authenticates through. BTP resolves a Role Collection's applicability by the pair `(user, origin)`, not by email alone — an assignment made under one Identity Provider does not apply if the user logs in via a different one.
- **Not conclusively verified in this project** — Whether `xs-security.json`'s `oauth2-configuration.redirect-uris` needs to include the Work Zone/launchpad domain specifically. Login through Work Zone's managed router did not visibly depend on this during testing, but this wasn't isolated/confirmed either way — don't treat its current value as proven correct or incorrect.

---

## 7. `manifest.json` / UI5 configuration requirements

- **Required** — `sap.cloud.service` must match the value registered in `mta.yaml`'s destination-content module (see section 3).
- **Required to understand** — `sap.app.id` becomes the app's name in the HTML5 repo with dots removed (verified: `sap.app.id: "itsm.ui"` registers as `itsmui` per `cf html5-list`). Renaming it changes what's registered as a new/separate app.
- **Required, verified via network trace** — `dataSources.*.uri` (and any other resource path meant to go through the app's own bundled `xs-app.json`) must be a **relative path with no leading `/`**. A leading slash resolves against the browser's current origin/domain root, not the app's own nested mount path under Work Zone — confirmed by comparing a working `Component.js` request (correctly prefixed with the app's mount path) against a failing OData request (going straight to the domain root instead).
- **Required for tile discovery** — `sap.app.crossNavigation.inbounds` defining the semantic object/action Work Zone uses to create a launchable tile.

---

## 8. How the deployed app becomes available in Work Zone

1. `ITSM-app-deployer` uploads the built zip into the `html5-apps-repo-host` instance.
2. `ITSM-destinationcontent` registers the HTML5-repo and UAA destinations under the app's `sap.cloud.service`.
3. In Work Zone's Content Manager, the app must be located via Content Explorer (discovered through the `sap.cloud.service`-tagged destinations) and explicitly added to a Group.
4. The Group must be added to a Role, the Role assigned to a Site, and the Site published/updated.
5. The user must have a Role Collection (granting the underlying app scope) assigned under the Identity Provider they actually log in with.

Steps 3–4 are Work Zone Cockpit actions, not code/config in this repo.

---

## 9. Checks to perform before attaching the app to Work Zone

- **Recommended** — `cf html5-list <appName> <version> <app_host_id>` — confirm `Component.js`, `manifest.json`, and `xs-app.json` are actually present in the deployed content, at the expected version.
- **Recommended** — Query the live destinations (`destination-configuration/v1/instanceDestinations`) and confirm the `sap.cloud.service` value matches `manifest.json` exactly.
- **Recommended** — Open the bundled `xs-app.json` from the deployed content (`cf html5-get`) and confirm its `"destination"` value is an actual registered Destination `Name`, not an MTA `provides` alias.
- **Recommended** — `cf apps` — confirm there is no leftover standalone approuter application still deployed if the architecture is meant to be managed-router-only.

---

## 10. Common configuration mistakes (all observed in this project)

- `manifest.json`'s `sap.cloud.service` drifting out of sync with `mta.yaml`'s destination-content `sap.cloud.service` (e.g. after a Git sync that overwrites one file but not the other) — causes `Component.js`/`manifest.json` 404s in Work Zone specifically, while working fine locally.
- `xs-app.json` referencing a destination by its MTA `provides:` alias instead of its actual registered Destination `Name`.
- Absolute (leading-slash) `dataSources.*.uri` values in `manifest.json`, which resolve incorrectly once the app is mounted under Work Zone's nested content path instead of a domain root.
- Role Collection user assignments left under a previous Identity Provider after switching/adding a new one for login.
