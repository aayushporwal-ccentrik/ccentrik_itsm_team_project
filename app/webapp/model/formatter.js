sap.ui.define([], function () {
  "use strict";

  var PRIORITY_STATE = {
    CRITICAL: "Error",
    HIGH: "Warning",
    MEDIUM: "Information",
    LOW: "Success"
  };

  // "Should text on this color be white or dark" — the standard YIQ
  // brightness formula (weights green highest, matching how the eye
  // perceives brightness). >=128 reads as light, so it gets dark text;
  // below that it's dark enough for white text to stay readable. Shared by
  // Component.js (the real header) and formatThemePreviewHtml below (the
  // admin's preview) so both make exactly the same call — the preview
  // would be lying otherwise.
  function isLightColor(sHex) {
    var s = (sHex || "").replace("#", "");
    if (s.length === 3) { s = s.split("").map(function (c) { return c + c; }).join(""); }
    if (s.length !== 6) { return false; }
    var r = parseInt(s.substr(0, 2), 16);
    var g = parseInt(s.substr(2, 2), 16);
    var b = parseInt(s.substr(4, 2), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 >= 128;
  }

  // Shared across controllers so every screen shows dates/priority the same way.
  return {
    formatDateTime: function (vDate) {
      if (!vDate) { return ""; }
      return new Date(vDate).toLocaleString();
    },

    formatPriorityState: function (sPriority) {
      return PRIORITY_STATE[sPriority] || "None";
    },

    isLightColor: isLightColor,

    // A faithful, larger mockup of the real End User dashboard — header,
    // the actual 6 KPI tiles, the ticket table, and the category donut —
    // not a simplified stand-in, so the admin can see the real layout, not
    // guess from an abstraction. Wrapped in a browser-chrome frame
    // (traffic-light dots + a fake address bar built from the org's own
    // code) so it reads as "a screenshot of your app". The LIVE badge +
    // settle-in animation exist for a real reason, not just decoration:
    // this whole block re-renders from scratch every time any theme field
    // changes (see the multi-part binding in OrganizationDetail.view.xml),
    // so both are honest, immediate feedback that what's on screen right
    // now matches what's currently saved in the form — not a stale render.
    //
    // Tiles/table/chart are always plain white cards, same as they'd be
    // there for the real GenericTile/.tablePane/.chartPane, whether or not
    // the page canvas around them is themed. Only two things move with
    // themeScope, exactly matching the real app: the header (its own solid
    // fill in HEADER scope, transparent — blending into the canvas — in
    // BACKGROUND scope) and the canvas behind everything (.appBg's usual
    // light blue in HEADER scope, the org's fill in BACKGROUND scope).
    // Returns a whole HTML string (not a style string) because sap.m
    // controls have no generic "style" property to bind to — sap.ui.core.HTML
    // is the standard way to render bound inline CSS in UI5. Colors are
    // admin-typed free text, validated as plain hex before going into a
    // style attribute; the logo URL and org code are escaped before going
    // into src=/text — both are string-built HTML, unlike the real app's
    // own logo/header, which UI5 sets safely via property binding.
    formatThemePreviewHtml: function (sThemeType, sThemeScope, sPrimary, sSecondary, sLogo, sCode, sNewTicketColor, sNewTicketText, sFormColor, sFormText) {
      var isHexColor = function (s) { return /^#[0-9a-fA-F]{3,8}$/.test(s || ""); };
      var escapeAttr = function (s) {
        return String(s || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      };
      var hexToRgba = function (sHex, fAlpha) {
        var s = (sHex || "").replace("#", "");
        if (s.length === 3) { s = s.split("").map(function (c) { return c + c; }).join(""); }
        if (s.length !== 6) { return "rgba(30,41,59," + fAlpha + ")"; }
        var r = parseInt(s.substr(0, 2), 16), g = parseInt(s.substr(2, 2), 16), b = parseInt(s.substr(4, 2), 16);
        return "rgba(" + r + "," + g + "," + b + "," + fAlpha + ")";
      };

      var sColor = isHexColor(sPrimary) ? sPrimary : "#e5e7eb";
      var sColor2 = isHexColor(sSecondary) ? sSecondary : "#1f2937";
      var sFill = sThemeType === "GRADIENT"
        ? "linear-gradient(to bottom," + sColor + "," + sColor2 + ")"
        : sColor;
      var sLogoSrc = escapeAttr(sLogo && sLogo.trim() ? sLogo.trim() : "images/ccentrik.png");
      var bBackground = sThemeScope === "BACKGROUND";
      var sDomain = escapeAttr((sCode || "yourorg").toLowerCase().replace(/[^a-z0-9]/g, "")) + ".servicedesk.app";

      // A light org color (e.g. white) needs dark text/button-label on top
      // of it, not the white this used to hardcode — same contrast call
      // Component.js makes for the real header, so this preview doesn't lie.
      var sTextOnFill = isLightColor(sColor) ? "#1e2a5e" : "#fff";
      var sGlow = hexToRgba(sColor, 0.35);

      // Button colors are their own group, decoupled from the header fill
      // above — same fallback values as style.css's .newTicketBtn/
      // .formActionBtn, so an org with nothing set previews exactly what
      // it'll actually look like. Delete keeps its own red default, same
      // as the real .dangerBtn rule, unless the admin sets a form color.
      var sNewTicketFill = isHexColor(sNewTicketColor) ? sNewTicketColor : "#2563eb";
      var sNewTicketTextC = isHexColor(sNewTicketText) ? sNewTicketText : "#fff";
      var sFormFillSet = isHexColor(sFormColor) ? sFormColor : "";
      var sDeleteFill = sFormFillSet || "#bb0000";
      var sFormFill = sFormFillSet || "#3b82f6";
      var sFormTextC = isHexColor(sFormText) ? sFormText : "#fff";

      var sHeaderStyle = bBackground ? "background:transparent;" : "background:" + sFill + ";";
      var sContentStyle = bBackground ? "background:" + sFill + ";" : "background:#eef2ff;";

      // Same 6 tiles, same order/colors as Dashboard.view.xml's default set
      // (Dashboard.controller.js's DEFAULT_TILE_KEYS + TILE_POOL colors).
      var aTiles = [
        { icon: "☷", label: "Total", value: 24, acc: "#021a86" },
        { icon: "+", label: "New", value: 5, acc: "#1d4ed8" },
        { icon: "↻", label: "In Process", value: 8, acc: "#eda100" },
        { icon: "☺", label: "Customer Action", value: 3, acc: "#e34948" },
        { icon: "♡", label: "Solution Proposed", value: 4, acc: "#f97316" },
        { icon: "✓", label: "Confirmed", value: 4, acc: "#22c55e" }
      ];
      var sTilesHtml = aTiles.map(function (o) {
        return "<div class=\"themePreviewTile\" style=\"border-left-color:" + o.acc + ";\">"
          + "<span class=\"themePreviewTileTop\">"
          + "<span class=\"themePreviewTileIcon\" style=\"color:" + o.acc + ";\">" + o.icon + "</span>"
          + "<span class=\"themePreviewTileValue\">" + o.value + "</span>"
          + "</span>"
          + "<span class=\"themePreviewTileLabel\">" + o.label + "</span>"
          + "</div>";
      }).join("");

      function tRow(sNo, sDesc, sStatus, sStatusClass, sPriority) {
        return "<div class=\"themePreviewTRow\">"
          + "<span class=\"themePreviewTCol themePreviewTColNo\">" + sNo + "</span>"
          + "<span class=\"themePreviewTCol themePreviewTColDesc\">" + sDesc + "</span>"
          + "<span class=\"themePreviewTCol themePreviewTColStatus " + sStatusClass + "\">" + sStatus + "</span>"
          + "<span class=\"themePreviewTCol themePreviewTColPriority\">" + sPriority + "</span>"
          + "</div>";
      }

      return ""
        + "<div class=\"themePreviewWindow\" style=\"box-shadow:0 0 0 1px rgba(15,23,42,.06), 0 20px 40px -12px " + sGlow + ";\">"
        +   "<div class=\"themePreviewChrome\">"
        +     "<span class=\"themePreviewDots\">"
        +       "<span class=\"themePreviewDot themePreviewDotRed\"></span>"
        +       "<span class=\"themePreviewDot themePreviewDotYellow\"></span>"
        +       "<span class=\"themePreviewDot themePreviewDotGreen\"></span>"
        +     "</span>"
        +     "<span class=\"themePreviewUrlBar\">&#128274; " + sDomain + "</span>"
        +     "<span class=\"themePreviewLiveBadge\"><span class=\"themePreviewLiveDot\"></span>LIVE</span>"
        +   "</div>"
        +   "<div class=\"themePreviewHeader\" style=\"" + sHeaderStyle + " color:" + sTextOnFill + ";\">"
        +     "<img class=\"themePreviewLogo\" src=\"" + sLogoSrc + "\" onerror=\"this.style.visibility='hidden'\"/>"
        +     "<span class=\"themePreviewTitle\" style=\"color:" + sTextOnFill + ";\">Service Desk Dashboard</span>"
        +     "<span class=\"themePreviewBtn\" style=\"background:" + sNewTicketFill + ";color:" + sNewTicketTextC + ";\">New Ticket</span>"
        +   "</div>"
        +   "<div class=\"themePreviewContent\" style=\"" + sContentStyle + "\">"
        +     "<div class=\"themePreviewTiles\">" + sTilesHtml + "</div>"
        +     "<div class=\"themePreviewSplit\">"
        +       "<div class=\"themePreviewTablePane\">"
        +         "<div class=\"themePreviewTHead\">"
        +           "<span class=\"themePreviewTCol themePreviewTColNo\">Incident #</span>"
        +           "<span class=\"themePreviewTCol themePreviewTColDesc\">Short Description</span>"
        +           "<span class=\"themePreviewTCol themePreviewTColStatus\">Status</span>"
        +           "<span class=\"themePreviewTCol themePreviewTColPriority\">Priority</span>"
        +         "</div>"
        +         tRow("INC-00231", "Password reset request", "New", "themePreviewBadgeNew", "Medium")
        +         tRow("INC-00230", "VPN not connecting from home", "In Process", "themePreviewBadgeProgress", "High")
        +         tRow("INC-00229", "Outlook not syncing", "Confirmed", "themePreviewBadgeClosed", "Low")
        +       "</div>"
        +       "<div class=\"themePreviewChartPane\">"
        +         "<span class=\"themePreviewChartTitle\">CATEGORY-WISE BREAKDOWN</span>"
        +         "<div class=\"themePreviewDonut\" style=\"background:conic-gradient(" + sColor + " 0% 55%, #1baf7a 55% 100%);\"></div>"
        +         "<div class=\"themePreviewCatRow\"><span class=\"themePreviewCatDot\" style=\"background:" + sColor + ";\"></span>Software</div>"
        +         "<div class=\"themePreviewCatRow\"><span class=\"themePreviewCatDot\" style=\"background:#1baf7a;\"></span>Hardware</div>"
        +       "</div>"
        +     "</div>"
        +   "</div>"
        + "</div>"
        + "<div class=\"themePreviewFormCard\">"
        +   "<span class=\"themePreviewChartTitle\">TICKET FORM BUTTONS</span>"
        +   "<div class=\"themePreviewFormBtnRow\">"
        +     "<span class=\"themePreviewBtn\" style=\"background:" + sDeleteFill + ";color:" + sFormTextC + ";\">Delete</span>"
        +     "<span class=\"themePreviewBtn\" style=\"background:" + sFormFill + ";color:" + sFormTextC + ";\">Save</span>"
        +     "<span class=\"themePreviewBtn\" style=\"background:" + sFormFill + ";color:" + sFormTextC + ";\">Submit</span>"
        +   "</div>"
        + "</div>";
    }
  };
});
