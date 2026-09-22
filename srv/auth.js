"use strict";

// Picks the authentication provider. CAP loads this file as its auth
// implementation (cds.requires.auth.impl in package.json), so whatever we
// export here *is* the middleware.
//
//   cds watch                   -> AUTH_PROVIDER=local   -> srv/auth/local-auth.js
//   cds watch --profile hybrid  -> AUTH_PROVIDER=cognito -> srv/auth/cognito-auth.js
//
// Both providers export the same shape: the middleware itself, plus
// mountAuthRoutes and sendPasswordSetupEmail as properties. Nothing else in
// the app needs to know which one is active.

// The active CAP profile sets this (package.json cds.requires.auth.provider);
// AUTH_PROVIDER overrides it, which is what the AWS deployment sets.
const cds = require("@sap/cds");

const PROVIDER = process.env.AUTH_PROVIDER || cds.env.requires?.auth?.provider || "local";

if (PROVIDER !== "local" && PROVIDER !== "cognito") {
  throw new Error(`Unknown AUTH_PROVIDER "${PROVIDER}" — expected "local" or "cognito"`);
}

console.log(`[auth] provider: ${PROVIDER}`);

module.exports = PROVIDER === "cognito"
  ? require("./auth/cognito-auth")
  : require("./auth/local-auth");
