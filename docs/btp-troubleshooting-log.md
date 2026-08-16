# BTP Troubleshooting Log

Running log of deployment/runtime issues hit on this project's SAP BTP Cloud Foundry setup. Newest entries on top.

---

## XSUAA service update silently fails when xsappname is renamed

**Problem:** After changing `xsappname` in `mta.yaml`, `cf deploy` reported `Updating service "ITSM-auth"` but every redeploy still hit the same login error — `OpenID provider cannot process the request due to configuration issues` — despite correct role collection assignment.

**Root Cause:** `xsappname` becomes a permanent AppId the moment an XSUAA service instance is first created. `cf deploy` only *updates* existing instances, never renames them — so any `xsappname` mismatch (`ITSM2`, `ITSMDEMO`, etc.) makes the entire XSUAA config update fail with `Cannot change AppId with update`. Because the update is all-or-nothing, unrelated config changes bundled in the same update (e.g. `oauth2-configuration.redirect-uris`) silently never applied either.

**Solution:** Reverted `xsappname` in `mta.yaml` to match the AppId the live instance was originally created with (`ITSM-${org}-${space}`). The XSUAA update then succeeded and the pending config changes finally took effect.

**Key Note:** Always check the `Updating service "..."` line in `cf deploy` output explicitly — a failure there doesn't stop the rest of the deploy (apps still start), so it's easy to miss. Renaming an XSUAA app for real requires deleting/recreating the service instance, which also orphans existing role collection assignments.

---

## UI5 app deployed but not served (404s after login, 302 on `/`)

**Problem:** App worked locally via `cds watch`, but on CF the root URL 302-redirected to `/webapp/index.html`, and once authenticated, all UI5 assets (`Component.js`, `manifest.json`, views, css) returned 404.

**Root Cause:** `app/webapp` was never packaged into any MTA module — `mta.yaml` had no module/route for it, and `xs-app.json` had a single catch-all route proxying everything to the CAP backend, which has no static content. Locally, `cds watch` auto-serves `app/` as a dev convenience; `cds build --production` does not bundle it anywhere.

**Solution:** Added a `before-all` build step (`cp -r app/webapp app/router/webapp`) so the UI5 app gets bundled into the approuter module at build time, and split `xs-app.json` into two routes: `/odata/*` → `srv-api` destination (backend), `/webapp/*` → `localDir` static serving (approuter).

**Key Note:** Confirm `gen/` build output actually contains the app content before deploying — a 302 on `/` is expected/by-design (`welcomeFile`), so don't stop investigating there; check what the *next* request (the static assets) actually returns.

---
