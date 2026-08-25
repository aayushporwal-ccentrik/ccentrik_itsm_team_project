sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "itsm/ui/model/formatter",
  "itsm/ui/model/auth"
], function (UIComponent, JSONModel, formatter, auth) {
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

  // The only pages reachable without a session. Anything else bounces to
  // the login screen.
  var PUBLIC_HASHES = ["login", "forgot-password", "reset-password"];

  function isPublicHash(sHash) {
    return PUBLIC_HASHES.some(function (sPublic) { return sHash.indexOf(sPublic) === 0; });
  }

  return UIComponent.extend("itsm.ui.Component", {
    metadata: { manifest: "json" },

    init: function () {
      UIComponent.prototype.init.apply(this, arguments);

      var that = this;
      var oRouter = this.getRouter();

      // Every OData request needs the JWT — the service is
      // authenticated-user only.
      auth.applyToken(this.getModel());

      // No session yet: open the login screen (or let a password-reset
      // link through) and stop. The rest of the app never loads.
      if (!auth.getToken() || !auth.getRole()) {
        if (!isPublicHash(oRouter.getHashChanger().getHash())) {
          oRouter.getHashChanger().setHash("login");
        }
        oRouter.initialize();
        return;
      }

      this._resolvePersona().then(function (oPersona) {
        if (!oPersona) { return; }

        that.setModel(new JSONModel(oPersona), "role");
        that._applyOrgTheme(oPersona.theme);
        that._guardRoutes(oRouter, oPersona.persona);

        // Set the URL to this persona's home page before the router
        // starts. This way it opens the right page directly, first try.
        var sHomeHash = auth.ROLE_ROUTES[oPersona.persona];
        if (sHomeHash && !oRouter.getHashChanger().getHash()) {
          oRouter.getHashChanger().setHash(sHomeHash);
        }

        oRouter.initialize();
      });
    },

    // Asks the server who is logged in (see srv/service.js currentUser()).
    // A failure here means the token is gone or expired — there is no
    // useful fallback persona any more, so send them back to login.
    _resolvePersona: function () {
      var that = this;
      var oAction = this.getModel().bindContext("/currentUser(...)");
      // getObject() reads the whole response at once — getProperty() on the
      // nested "theme" complex property here can throw synchronously in the
      // v4 model, which would otherwise take the persona/userName reads
      // down with it into the catch below.
      return oAction.execute().then(function () {
        var oPersona = oAction.getBoundContext().getObject();

        // Extras for the header's account menu (view/UserMenu.fragment.xml).
        oPersona.roleLabel = auth.ROLE_LABELS[oPersona.persona] || oPersona.persona;
        oPersona.switchableRoles = (oPersona.roles || [])
          .filter(function (sRole) { return sRole !== oPersona.persona; })
          .map(function (sRole) { return { code: sRole, name: auth.ROLE_LABELS[sRole] || sRole }; });

        return oPersona;
      }).catch(function () {
        that.logout();
        return null;
      });
    },

    // Called by the Login page once /auth/login has answered.
    onLoggedIn: function (oData) {
      if (!oData.requiresRoleSelection) {
        return this.enterApp(oData.role);
      }

      this.setModel(new JSONModel({ userName: oData.user.name, roles: oData.roles }), "roleSelect");
      this.getRouter().navTo("selectRole");
    },

    // Entering the app as a role — after login, and after every role
    // switch. A full reload is deliberate: persona drives the route guards,
    // the theme and every page's bindings, and reloading is far simpler
    // than unwinding all of that in place. The token is in sessionStorage,
    // so no password is asked for again.
    enterApp: function (sRole) {
      window.location.hash = "#/" + (auth.ROLE_ROUTES[sRole] || "");
      window.location.reload();
    },

    logout: function () {
      auth.clearSession();
      window.location.hash = "#/login";
      window.location.reload();
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
    // Two more pairs, set only when the admin has actually picked a color —
    // otherwise left unset so CSS's own hardcoded fallback applies. Always a
    // flat hex, never linear-gradient(...): the "New Ticket" button and the
    // ticket form's action buttons must never render as a gradient, even
    // when the org's header/background theme is set to Gradient.
    // --new-ticket-fill / --new-ticket-text   Dashboard's "New Ticket" button
    // --form-action-fill / --form-action-text  ticket form's Delete/Edit/
    //                        Save/Assign/Resolve/Close/Submit buttons
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

      if (isHexColor(oTheme.newTicketBtnColor)) { oHtml.style.setProperty("--new-ticket-fill", oTheme.newTicketBtnColor); }
      if (isHexColor(oTheme.newTicketBtnTextColor)) { oHtml.style.setProperty("--new-ticket-text", oTheme.newTicketBtnTextColor); }
      if (isHexColor(oTheme.formBtnColor)) { oHtml.style.setProperty("--form-action-fill", oTheme.formBtnColor); }
      if (isHexColor(oTheme.formBtnTextColor)) { oHtml.style.setProperty("--form-action-text", oTheme.formBtnTextColor); }
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
