const cds = require("@sap/cds");
const { mountAuthRoutes } = require("./auth");

// Registered on bootstrap so /auth/* sits in front of CAP's auth middleware
// and stays reachable without a token.
cds.on("bootstrap", mountAuthRoutes);

module.exports = cds.server;
