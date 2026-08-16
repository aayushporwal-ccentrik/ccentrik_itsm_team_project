sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
  "use strict";

  // Routes each persona can open. "detail" is not in any list — every
  // persona can open a ticket, the form itself changes based on who is
  // looking (see model/roleConfig.js).
  var CONSULTANT_ROUTES = ["assigned"];
  var SUPPORT_ONLY_ROUTES = ["serviceGroupDashboard"];
  var END_USER_ROUTES = ["dashboard", "create"];

  // Home page URL for each persona. Same value as the route pattern in
  // manifest.json.
  var HOME_HASH_BY_PERSONA = {
    SERVICE_GROUP: "service-group-dashboard",
    CONSULTANT: "assigned"
  };

  return UIComponent.extend("itsm.ui.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      var that = this;
      var oRouter = this.getRouter();

      this._resolvePersona().then(function (oPersona) {
        that.setModel(new JSONModel(oPersona), "role");
        that._guardRoutes(oRouter, oPersona.persona);

        // Set the URL to this persona's home page before the router
        // starts. This way it opens the right page directly, first try.
        var sHomeHash = HOME_HASH_BY_PERSONA[oPersona.persona];
        if (sHomeHash && !oRouter.getHashChanger().getHash()) {
          oRouter.getHashChanger().setHash(sHomeHash);
        }

        oRouter.initialize();
      });
    },

    // Asks the server who is logged in (see srv/service.js currentUser()).
    // If that fails, treat the user as End User instead of blocking the app.
    _resolvePersona: function () {
      var oAction = this.getModel().bindContext("/currentUser(...)");
      return oAction.execute().then(function () {
        var oCtx = oAction.getBoundContext();
        return { persona: oCtx.getProperty("persona"), userName: oCtx.getProperty("userName") };
      }).catch(function () {
        return { persona: "END_USER", userName: "" };
      });
    },

    // Sends the user home if they open a route that is not theirs.
    _guardRoutes: function (oRouter, sPersona) {
      var aGuarded, sHome;

      if (sPersona === "CONSULTANT") {
        aGuarded = SUPPORT_ONLY_ROUTES.concat(END_USER_ROUTES);
        sHome = "assigned";
      } else if (sPersona === "SERVICE_GROUP") {
        aGuarded = CONSULTANT_ROUTES;
        sHome = "serviceGroupDashboard";
      } else {
        aGuarded = CONSULTANT_ROUTES.concat(SUPPORT_ONLY_ROUTES);
        sHome = "dashboard";
      }

      aGuarded.forEach(function (sRouteName) {
        var oRoute = oRouter.getRoute(sRouteName);
        if (!oRoute) { return; }
        oRoute.attachPatternMatched(function () {
          oRouter.navTo(sHome, {}, true);
        });
      });
    },

    // Used to pass a filter from one page to another. Example: click a
    // chart on Service Group Dashboard, it saves the filter here, then
    // goes to the ticket list, which reads it from here.
    setPendingTicketFilter: function (oFilter) {
      this._oPendingTicketFilter = oFilter;
    },

    takePendingTicketFilter: function () {
      var oFilter = this._oPendingTicketFilter;
      this._oPendingTicketFilter = null;
      return oFilter;
    }
  });
});
