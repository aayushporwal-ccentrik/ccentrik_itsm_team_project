sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "itsm/ui/model/formatter"
], function (UIComponent, JSONModel, formatter) {
  "use strict";

  // Routes each persona can open. "detail" is not in any list — every
  // persona can open a ticket, the form itself changes based on who is
  // looking (see model/roleConfig.js).
  var CONSULTANT_ROUTES = ["assigned"];
  var SUPPORT_ONLY_ROUTES = ["serviceGroupDashboard"];
  var END_USER_ROUTES = ["dashboard", "create"];
  // Admin only manages organizations — no ticket-handling access at all,
  // so "detail" (open otherwise to every persona) is guarded here too.
  var ADMIN_ROUTES = ["organizations", "organizationDetail"];

  // Home page URL for each persona. Same value as the route pattern in
  // manifest.json.
  var HOME_HASH_BY_PERSONA = {
    SERVICE_GROUP: "service-group-dashboard",
    CONSULTANT: "assigned",
    ADMIN: "organizations"
  };

  return UIComponent.extend("itsm.ui.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      var that = this;
      var oRouter = this.getRouter();

      this._resolvePersona().then(function (oPersona) {
        that.setModel(new JSONModel(oPersona), "role");
        that._applyOrgTheme(oPersona.theme);
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
      // getObject() reads the whole response at once — getProperty() on the
      // nested "theme" complex property here can throw synchronously in the
      // v4 model, which would otherwise take the persona/userName reads
      // down with it into the catch below (silently, as a blank End User).
      return oAction.execute().then(function () {
        return oAction.getBoundContext().getObject();
      }).catch(function () {
        return { persona: "END_USER", userName: "" };
      });
    },

    // Re-skins the app for an End User whose organization has a theme set.
    // Everyone else (Service Group/Consultant/Admin, or an org with no
    // colors set) gets no override and keeps the app's default look.
    // Colors are admin-typed free text (see Organization theme editor), so
    // they're validated as plain hex before reaching a real CSS property.
    //
    // Three CSS custom properties do the work:
    // --brand-fill           solid-or-gradient — used for backgrounds
    //                        (header, buttons, whole-page canvas in
    //                        BACKGROUND scope)
    // --brand-text-on-fill   white or dark — for text/icons sitting ON TOP
    //                        of --brand-fill (header title, button labels).
    //                        A light org color (e.g. white/pale yellow)
    //                        needs dark text here, not the white this used
    //                        to hardcode — that's what made the heading and
    //                        buttons disappear when someone picked white.
    // --brand-accent-on-white  solid — for text that sits on a surface that
    //                        stays fixed white regardless of theme (the
    //                        header's white pill buttons). A light primary
    //                        wouldn't read there either, so it falls back
    //                        to the app's original navy instead of reusing
    //                        the too-light color.
    //
    // themeScope picks WHERE --brand-fill is consumed as the page's canvas:
    // HEADER (default) -> just the header strip; .appBg (and cards/tables
    // on top of it, which have their own explicit white backgrounds already
    // and are untouched here) stay the app's normal light background.
    // BACKGROUND -> the whole .appBg canvas gets --brand-fill instead, and
    // the header itself goes transparent so it blends into one continuous
    // top-to-bottom surface rather than sitting in its own separate box.
    _applyOrgTheme: function (oTheme) {
      var isHexColor = function (s) { return /^#[0-9a-fA-F]{3,8}$/.test(s || ""); };
      if (!oTheme || !isHexColor(oTheme.primaryColor)) { return; }

      // A Gradient type with no secondary color picked yet still needs to
      // look like a gradient, not silently collapse back to a solid block —
      // falls back to a fixed dark shade rather than repeating the primary.
      var sSecondary = isHexColor(oTheme.secondaryColor) ? oTheme.secondaryColor : "#1f2937";
      var sFill = oTheme.themeType === "GRADIENT"
        ? "linear-gradient(to bottom, " + oTheme.primaryColor + ", " + sSecondary + ")"
        : oTheme.primaryColor;
      var bLight = formatter.isLightColor(oTheme.primaryColor);

      var oHtml = document.documentElement;
      oHtml.style.setProperty("--brand-fill", sFill);
      oHtml.style.setProperty("--brand-accent", oTheme.primaryColor);
      oHtml.style.setProperty("--brand-text-on-fill", bLight ? "#1e2a5e" : "#ffffff");
      oHtml.style.setProperty("--brand-accent-on-white", bLight ? "#021a86" : oTheme.primaryColor);
      oHtml.setAttribute("data-theme-scope", oTheme.themeScope === "BACKGROUND" ? "background" : "header");
    },

    // Sends the user home if they open a route that is not theirs.
    _guardRoutes: function (oRouter, sPersona) {
      var aGuarded, sHome;

      if (sPersona === "ADMIN") {
        aGuarded = CONSULTANT_ROUTES.concat(SUPPORT_ONLY_ROUTES, END_USER_ROUTES, ["detail"]);
        sHome = "organizations";
      } else if (sPersona === "CONSULTANT") {
        aGuarded = SUPPORT_ONLY_ROUTES.concat(END_USER_ROUTES, ADMIN_ROUTES);
        sHome = "assigned";
      } else if (sPersona === "SERVICE_GROUP") {
        aGuarded = CONSULTANT_ROUTES.concat(ADMIN_ROUTES);
        sHome = "serviceGroupDashboard";
      } else {
        aGuarded = CONSULTANT_ROUTES.concat(SUPPORT_ONLY_ROUTES, ADMIN_ROUTES);
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
    },

    // Same idea, for the ticket type picked in the "New Ticket" popup
    // before the create form even opens.
    setPendingTicketType: function (sTicketType) {
      this._sPendingTicketType = sTicketType;
    },

    takePendingTicketType: function () {
      var sTicketType = this._sPendingTicketType;
      this._sPendingTicketType = null;
      return sTicketType;
    }
  });
});
