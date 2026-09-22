const cds = require("@sap/cds");
const { mountAuthRoutes } = require("./auth");

// Registered on bootstrap so /auth/* sits in front of CAP's auth middleware
// and stays reachable without a token.
cds.on("bootstrap", mountAuthRoutes);

// cds watch serves app/ in dev; cds-serve doesn't, so production has to.
if (process.env.NODE_ENV === "production") {
  cds.on("bootstrap", app => {
    app.use("/webapp", require("express").static(require("path").join(__dirname, "../app/webapp")));
  });
}

module.exports = cds.server;
