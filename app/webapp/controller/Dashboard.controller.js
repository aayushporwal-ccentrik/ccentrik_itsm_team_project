sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "itsm/ui/model/lookupValues",
  "itsm/ui/model/formatter",
  "itsm/ui/model/userMenu"
], function (Controller, JSONModel, Filter, FilterOperator, MessageToast, fetchLookup, formatter, userMenu) {
  "use strict";

  // The full pool of KPI tiles a user can choose from — exactly 6 are
  // shown at a time (see TILE_COUNT / onManageTiles). Colors are
  // sap.m.ValueState names, read by NumericContent's valueColor.
  var TILE_POOL = [
    { key: "", label: "Total", icon: "sap-icon://list", color: "Neutral" },
    { key: "NEW", label: "New", icon: "sap-icon://add-document", color: "Neutral" },
    { key: "IN_PROCESS", label: "In Process", icon: "sap-icon://synchronize", color: "Critical" },
    { key: "CUSTOMER_ACTION", label: "Customer Action", icon: "sap-icon://customer", color: "Error" },
    { key: "SOLUTION_PROPOSED", label: "Solution Proposed", icon: "sap-icon://lightbulb", color: "Neutral" },
    { key: "CONFIRMED", label: "Confirmed", icon: "sap-icon://accept", color: "Good" },
    { key: "CLOSED", label: "Closed", icon: "sap-icon://complete", color: "Good" }
  ];
  var DEFAULT_TILE_KEYS = ["", "NEW", "IN_PROCESS", "CUSTOMER_ACTION", "SOLUTION_PROPOSED", "CONFIRMED"];
  var TILE_COUNT = 6;
  var TILE_PREF_KEY = "itsm.dashboard.tileKeys";

  var CLOSED_STATUS_CODE = "CLOSED";

  var PERSONA_LABELS = {
    END_USER: "End User",
    SERVICE_GROUP: "Service Group",
    CONSULTANT: "Consultant",
    ADMIN: "Admin"
  };

  // Same categorical palette as the rest of the app's charts.
  var CHART_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];

  return Controller.extend("itsm.ui.controller.Dashboard", {
    // Header account popover: current role, role switch, logout.
    onUserMenu: function (oEvent) {
      userMenu.open(this, oEvent.getSource());
    },

    formatDateTime: formatter.formatDateTime,
    formatPriorityState: formatter.formatPriorityState,

    // Only wiring up the route here. The OData model isn't propagated to
    // the view yet at this point (the view isn't attached to the app's
    // control tree until the route actually matches), so any data loading
    // has to wait for _onShow.
    onInit: function () {
      this._mFilters = {
        status: "", category: "", priority: "", priorityGroup: "", assignee: "", team: "", ticketType: "", client: "",
        unassignedOnly: false, assignedOnly: false, excludeClosed: false,
        slaState: "", agingBucket: "", createdDay: "", search: ""
      };
      this._aTileKeys = this._loadTileKeyPref();

      // Seeded up front (all zero counts) so the tile row always has a
      // model to bind to. Without this, the row stays empty — not showing
      // zeros, but literally rendering nothing — until _loadTiles' async
      // request resolves, and permanently so if it ever errors.
      this.getView().setModel(new JSONModel({
        tiles: this._buildTiles([]),
        categoryData: [],
        tableTitle: ""
      }), "dash");

      this.getOwnerComponent().getRouter().getRoute("dashboard").attachPatternMatched(this._onShow, this);
    },

    // Runs every time the dashboard is opened, so it also picks up changes
    // like a newly created ticket. The lookup-driven filter dropdowns and
    // the chart colors only need setting up once.
    _onShow: function () {
      if (!this._bFiltersLoaded) {
        this._buildFiltersModel();
        this._setupChart();
        this._bFiltersLoaded = true;
      }
      this._applyPendingFilter();
      this._applyFilters();
      this._loadTiles();
    },

    // Picks up a filter stashed by another page (e.g. a chart on the
    // Service Group Dashboard) before it navigated here. Only touches the
    // dropdowns that actually have a matching value to show, so the rest
    // of the filter state (e.g. a text search) is left alone.
    _applyPendingFilter: function () {
      var oPending = this.getOwnerComponent().takePendingTicketFilter();
      if (!oPending) { return; }

      this._mFilters.status = oPending.status || "";
      this._mFilters.category = oPending.category || "";
      this._mFilters.priority = oPending.priority || "";
      this._mFilters.priorityGroup = oPending.priorityGroup || "";
      this._mFilters.assignee = oPending.assignee || "";
      this._mFilters.team = oPending.team || "";
      this._mFilters.ticketType = oPending.ticketType || "";
      this._mFilters.client = oPending.client || "";
      this._mFilters.unassignedOnly = !!oPending.unassignedOnly;
      this._mFilters.assignedOnly = !!oPending.assignedOnly;
      this._mFilters.excludeClosed = !!oPending.excludeClosed;
      this._mFilters.slaState = oPending.slaState || "";
      this._mFilters.agingBucket = oPending.agingBucket || "";
      this._mFilters.createdDay = oPending.createdDay || "";
      this._sPendingTitle = oPending.label || "";

      if (this.byId("categoryFilter")) { this.byId("categoryFilter").setSelectedKey(this._mFilters.category); }
      if (this.byId("priorityFilter")) { this.byId("priorityFilter").setSelectedKey(this._mFilters.priority); }
      if (this.byId("assigneeFilter")) { this.byId("assigneeFilter").setSelectedKey(this._mFilters.assignee); }
      if (this.byId("clientFilter")) { this.byId("clientFilter").setSelectedKey(this._mFilters.client); }
    },

    // Legend off — with several categories it overflows into its own
    // scrollbar; the color key beside the donut covers that job instead.
    _setupChart: function () {
      var oChart = this.byId("categoryChart");
      if (!oChart) { return; }
      oChart.setVizProperties({
        plotArea: { colorPalette: CHART_PALETTE },
        legend: { visible: false }
      });
    },

    _buildFiltersModel: function () {
      var oModel = this.getOwnerComponent().getModel();
      var oFiltersModel = new JSONModel({
        categories: [{ code: "", name: "All Categories" }],
        priorities: [{ code: "", name: "All Priorities" }],
        assignees: [{ code: "", name: "All Assignees" }],
        clients: [{ code: "", name: "All Clients" }]
      });
      this.getView().setModel(oFiltersModel, "filters");

      fetchLookup(oModel, "CATEGORY1").then(function (aRows) {
        oFiltersModel.setProperty("/categories", [{ code: "", name: "All Categories" }].concat(aRows));
      });
      fetchLookup(oModel, "PRIORITY").then(function (aRows) {
        oFiltersModel.setProperty("/priorities", [{ code: "", name: "All Priorities" }].concat(aRows));
      });
      // Clients now come from the Organizations admin panel, not a generic
      // lookup — one read, reused below for both the filter and the name map.
      var pOrgOptions = oModel.bindList("/Organizations", undefined, undefined,
        new Filter("isActive", FilterOperator.EQ, true), { $orderby: "name" }
      ).requestContexts().then(function (aContexts) {
        return aContexts.map(function (oCtx) { var o = oCtx.getObject(); return { code: o.code, name: o.name }; });
      });
      pOrgOptions.then(function (aRows) {
        oFiltersModel.setProperty("/clients", [{ code: "", name: "All Clients" }].concat(aRows));
      });

      // Status/priority/client code -> display name, used by the table's
      // formatters below. Same lookup data as the filter dropdowns.
      var that = this;
      fetchLookup(oModel, "STATUS").then(function (aRows) { that._mStatusName = that._toNameMap(aRows); });
      fetchLookup(oModel, "PRIORITY").then(function (aRows) { that._mPriorityName = that._toNameMap(aRows); });
      fetchLookup(oModel, "CATEGORY1").then(function (aRows) { that._mCategoryName = that._toNameMap(aRows); });
      pOrgOptions.then(function (aRows) { that._mClientName = that._toNameMap(aRows); });
    },

    _toNameMap: function (aRows) {
      var oMap = {};
      aRows.forEach(function (r) { oMap[r.code] = r.name; });
      return oMap;
    },

    formatStatusName: function (sCode) { return (this._mStatusName && this._mStatusName[sCode]) || sCode || ""; },
    formatPriorityName: function (sCode) { return (this._mPriorityName && this._mPriorityName[sCode]) || sCode || ""; },
    formatCategoryName: function (sCode) { return (this._mCategoryName && this._mCategoryName[sCode]) || sCode || ""; },
    formatClientName: function (sCode) { return (this._mClientName && this._mClientName[sCode]) || sCode || ""; },

    // No fabricated per-priority SLA target hours here — "dueAt" is a
    // real field the Service Group sets on the ticket, so overdue simply
    // means the due date has passed and the ticket isn't done yet.
    formatSlaText: function (sDueAt, sCompletedAt) {
      if (sCompletedAt) { return "Met"; }
      if (!sDueAt) { return "-"; }
      return new Date(sDueAt) < new Date() ? "Response Overdue" : "On Track";
    },

    formatSlaState: function (sDueAt, sCompletedAt) {
      if (sCompletedAt) { return "Success"; }
      if (!sDueAt) { return "None"; }
      return new Date(sDueAt) < new Date() ? "Error" : "Success";
    },

    // End User only sees their own tickets; Service Group sees everything.
    _isOwnTicketsOnly: function () {
      return this.getOwnerComponent().getModel("role").getProperty("/persona") === "END_USER";
    },

    /* ---------------------------------------------------------
     * Which 6 tiles to show — persisted in localStorage so the choice
     * survives a reload. Falls back to the default set (and repairs a
     * stored list that's gone stale, e.g. from an older tile pool).
     * ------------------------------------------------------- */
    _loadTileKeyPref: function () {
      try {
        var aSaved = JSON.parse(window.localStorage.getItem(TILE_PREF_KEY));
        if (Array.isArray(aSaved) && aSaved.length === TILE_COUNT &&
            aSaved.every(function (k) { return TILE_POOL.some(function (t) { return t.key === k; }); })) {
          return aSaved;
        }
      } catch (e) { /* ignore malformed/blocked storage, fall back below */ }
      return DEFAULT_TILE_KEYS.slice();
    },

    _saveTileKeyPref: function (aKeys) {
      try { window.localStorage.setItem(TILE_PREF_KEY, JSON.stringify(aKeys)); }
      catch (e) { /* storage unavailable — selection just won't persist */ }
    },

    // One read feeds the KPI tiles, the trend badges, the category
    // donut/list and the assignee filter — no point making a separate
    // request per widget. Scoped by the same filters as the table (minus
    // status) so the tiles reflect whatever's currently filtered, e.g. an
    // engineer's tickets after drilling in from Service Group Dashboard.
    _loadTiles: function () {
      var that = this;
      var mParams = {
        $select: "status,messageProcessor,createdAt",
        $expand: "incidentForm($select=category1)"
      };

      this.getOwnerComponent().getModel().bindList("/Tickets", undefined, undefined, this._buildScopeFilters(false), mParams).requestContexts()
        .then(function (aContexts) {
          var aTickets = aContexts.map(function (oCtx) { return oCtx.getObject(); });

          that.getView().setModel(new JSONModel({
            tiles: that._buildTiles(aTickets),
            categoryData: that._buildCategoryData(aTickets),
            tableTitle: that._sPendingTitle || "All Incidents"
          }), "dash");
          that._sPendingTitle = "";
          that._syncTileClasses();
          that._updateAssigneeOptions(aTickets);
        })
        .catch(function () {
          // Request failed (e.g. backend/DB not reachable) — fall back to
          // zeroed tiles instead of leaving the row permanently empty.
          that.getView().setModel(new JSONModel({
            tiles: that._buildTiles([]),
            categoryData: [],
            tableTitle: that._sPendingTitle || "All Incidents"
          }), "dash");
          that._sPendingTitle = "";
          that._syncTileClasses();
        });
    },

    // "This week vs. last week" per tile, bucketed by createdAt — the
    // only history we actually have (no snapshot of past status exists).
    _buildTiles: function (aTickets) {
      var iNow = Date.now();
      var WEEK_MS = 7 * 24 * 60 * 60 * 1000;

      function weekBucket(sCreatedAt) {
        var iAge = iNow - new Date(sCreatedAt).getTime();
        if (iAge < WEEK_MS) { return "this"; }
        if (iAge < 2 * WEEK_MS) { return "last"; }
        return null;
      }

      var that = this;
      return TILE_POOL
        .filter(function (t) { return that._aTileKeys.indexOf(t.key) !== -1; })
        .map(function (t) {
          var aMatching = aTickets.filter(function (ticket) { return t.key === "" || ticket.status === t.key; });
          var iThisWeek = 0, iLastWeek = 0;
          aMatching.forEach(function (ticket) {
            var sBucket = weekBucket(ticket.createdAt);
            if (sBucket === "this") { iThisWeek++; } else if (sBucket === "last") { iLastWeek++; }
          });

          return {
            key: t.key,
            label: t.label,
            icon: t.icon,
            color: t.color,
            count: aMatching.length,
            selected: t.key === (that._mFilters.status || ""),
            trendLabel: that._formatTrend(iThisWeek, iLastWeek)
          };
        });
    },

    _formatTrend: function (iThisWeek, iLastWeek) {
      if (!iThisWeek && !iLastWeek) { return ""; }
      if (!iLastWeek) { return "▲ all new"; }
      var iPercent = Math.round(((iThisWeek - iLastWeek) / iLastWeek) * 100);
      if (iPercent === 0) { return "– no change"; }
      return (iPercent > 0 ? "▲ " : "▼ ") + Math.abs(iPercent) + "%";
    },

    // Category breakdown, each row split into its own open vs. closed share.
    _buildCategoryData: function (aTickets) {
      var that = this;
      var mByCategory = {};
      aTickets.forEach(function (t) {
        var sCode = (t.incidentForm && t.incidentForm.category1) || "";
        var sName = sCode ? (that._mCategoryName && that._mCategoryName[sCode]) || sCode : "Uncategorized";
        var oRow = mByCategory[sName] || (mByCategory[sName] = { name: sName, count: 0, openCount: 0, closedCount: 0 });
        oRow.count++;
        if (t.status === CLOSED_STATUS_CODE) { oRow.closedCount++; } else { oRow.openCount++; }
      });

      return Object.keys(mByCategory).map(function (k) {
        var oRow = mByCategory[k];
        var iOpenPercent = oRow.count ? Math.round((oRow.openCount / oRow.count) * 100) : 0;
        oRow.openPercent = iOpenPercent;
        oRow.closedPercent = 100 - iOpenPercent;
        return oRow;
      }).sort(function (a, b) { return b.count - a.count; });
    },

    // Assignee filter options come from who tickets are actually assigned
    // to right now — there's no separate Users list exposed to pick from.
    _updateAssigneeOptions: function (aTickets) {
      var aNames = aTickets.map(function (t) { return t.messageProcessor; }).filter(Boolean);
      var aUnique = aNames.filter(function (n, i) { return aNames.indexOf(n) === i; }).sort();
      var oFiltersModel = this.getView().getModel("filters");
      oFiltersModel.setProperty("/assignees", [{ code: "", name: "All Assignees" }].concat(
        aUnique.map(function (n) { return { code: n, name: n }; })
      ));
    },

    /* ---------------------------------------------------------
     * Binding the GenericTile's "class" attribute doesn't reliably
     * resolve for this control, so the accent (acc1..acc6) and selection
     * (kpiSel) classes are applied directly on the control instances,
     * every time the tiles model changes.
     * ------------------------------------------------------- */
    _syncTileClasses: function () {
      var oHBox = this.byId("tileRow");
      if (!oHBox) { return; }
      oHBox.getItems().forEach(function (oWrap, i) {
        var oTile = oWrap.getItems()[0];
        var oCtx = oTile.getBindingContext("dash");
        oTile.addStyleClass("acc" + (i + 1));
        oTile.toggleStyleClass("kpiSel", !!(oCtx && oCtx.getProperty("selected")));
      });
    },

    // Shared by the table (_applyFilters) and the KPI tiles (_loadTiles),
    // so both always agree on which tickets are "in scope". Status is left
    // out for the tiles: they're a breakdown BY status, so counting each
    // one against an already status-filtered set would be wrong.
    _buildScopeFilters: function (bIncludeStatus) {
      var aFilters = [];

      if (this._isOwnTicketsOnly()) {
        aFilters.push(new Filter("reportedBy", FilterOperator.EQ, this.getOwnerComponent().getModel("role").getProperty("/userName")));
      } else {
        // Service Group sees everyone's tickets, but a Draft is still an
        // End User's unsubmitted work-in-progress form — not theirs to see
        // or triage until it's actually been submitted (status != DRAFT).
        aFilters.push(new Filter("status", FilterOperator.NE, "DRAFT"));
      }
      if (bIncludeStatus && this._mFilters.status) {
        aFilters.push(new Filter("status", FilterOperator.EQ, this._mFilters.status));
      }
      if (this._mFilters.category) {
        aFilters.push(new Filter("incidentForm/category1", FilterOperator.EQ, this._mFilters.category));
      }
      if (this._mFilters.priority) {
        aFilters.push(new Filter("priority", FilterOperator.EQ, this._mFilters.priority));
      }
      if (this._mFilters.priorityGroup === "highCritical") {
        aFilters.push(new Filter({
          and: false,
          filters: [
            new Filter("priority", FilterOperator.EQ, "HIGH"),
            new Filter("priority", FilterOperator.EQ, "CRITICAL")
          ]
        }));
      }
      if (this._mFilters.assignee) {
        aFilters.push(new Filter("messageProcessor", FilterOperator.EQ, this._mFilters.assignee));
      }
      if (this._mFilters.team) {
        aFilters.push(new Filter("supportTeam", FilterOperator.EQ, this._mFilters.team));
      }
      if (this._mFilters.client) {
        aFilters.push(new Filter("reportedByUser/client", FilterOperator.EQ, this._mFilters.client));
      }
      if (this._mFilters.unassignedOnly) {
        aFilters.push(new Filter("messageProcessor", FilterOperator.EQ, null));
      }
      if (this._mFilters.assignedOnly) {
        aFilters.push(new Filter("messageProcessor", FilterOperator.NE, null));
      }
      if (this._mFilters.excludeClosed) {
        aFilters.push(new Filter("status", FilterOperator.NE, "CLOSED"));
      }
      if (this._mFilters.ticketType) {
        aFilters.push(new Filter("ticketType", FilterOperator.EQ, this._mFilters.ticketType));
      }
      if (this._mFilters.slaState === "breached") {
        aFilters.push(new Filter("dueAt", FilterOperator.LT, new Date().toISOString()));
        aFilters.push(new Filter("completedAt", FilterOperator.EQ, null));
      } else if (this._mFilters.slaState === "dueSoon") {
        var oNow = new Date();
        var oIn2h = new Date(oNow.getTime() + 2 * 60 * 60 * 1000);
        aFilters.push(new Filter("dueAt", FilterOperator.BT, oNow.toISOString(), oIn2h.toISOString()));
        aFilters.push(new Filter("completedAt", FilterOperator.EQ, null));
      } else if (this._mFilters.slaState === "withinSla") {
        // Not breached and not due soon: already done, or the due date
        // is either not set yet or still far away.
        var oIn2hB = new Date(Date.now() + 2 * 60 * 60 * 1000);
        aFilters.push(new Filter({
          and: false,
          filters: [
            new Filter("completedAt", FilterOperator.NE, null),
            new Filter("dueAt", FilterOperator.EQ, null),
            new Filter("dueAt", FilterOperator.GT, oIn2hB.toISOString())
          ]
        }));
      }
      if (this._mFilters.agingBucket) {
        aFilters = aFilters.concat(this._agingFilters(this._mFilters.agingBucket));
      }
      if (this._mFilters.createdDay) {
        var oDayStart = new Date(this._mFilters.createdDay + "T00:00:00.000Z");
        var oDayEnd = new Date(oDayStart.getTime() + 24 * 60 * 60 * 1000);
        aFilters.push(new Filter("createdAt", FilterOperator.GE, oDayStart.toISOString()));
        aFilters.push(new Filter("createdAt", FilterOperator.LT, oDayEnd.toISOString()));
      }
      if (this._mFilters.search) {
        aFilters.push(new Filter({
          and: false,
          filters: [
            new Filter("ticketNumber", FilterOperator.Contains, this._mFilters.search),
            new Filter("shortDescription", FilterOperator.Contains, this._mFilters.search)
          ]
        }));
      }

      return aFilters;
    },

    _applyFilters: function () {
      // filter() alone is a no-op when the new filters are equal to the
      // ones already applied (e.g. reopening the dashboard with nothing
      // changed) — it skips re-fetching, so a ticket created in the
      // meantime wouldn't show up. refresh() forces a real re-fetch.
      var oBinding = this.byId("dashTable").getBinding("items");
      oBinding.filter(this._buildScopeFilters(true));
      oBinding.refresh();
    },

    // How many days old a ticket is, turned into a createdAt range.
    _agingFilters: function (sBucket) {
      var DAY_MS = 24 * 60 * 60 * 1000;
      var oNow = new Date();
      var oRanges = {
        "0-1": [0, 1],
        "1-3": [1, 3],
        "3-7": [3, 7],
        "7+": [7, null]
      };
      var aRange = oRanges[sBucket];
      if (!aRange) { return []; }

      var oNewestAllowed = new Date(oNow.getTime() - aRange[0] * DAY_MS);
      var aFilters = [new Filter("createdAt", FilterOperator.LE, oNewestAllowed.toISOString())];
      if (aRange[1] !== null) {
        var oOldestAllowed = new Date(oNow.getTime() - aRange[1] * DAY_MS);
        aFilters.push(new Filter("createdAt", FilterOperator.GE, oOldestAllowed.toISOString()));
      }
      return aFilters;
    },

    onFilterChange: function () {
      this._mFilters.category = this.byId("categoryFilter").getSelectedKey();
      this._mFilters.priority = this.byId("priorityFilter").getSelectedKey();
      this._mFilters.assignee = this.byId("assigneeFilter").getSelectedKey();
      this._mFilters.client = this.byId("clientFilter").getSelectedKey();
      this._applyFilters();
      this._loadTiles();
    },

    onSearch: function (oEvent) {
      this._mFilters.search = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
      this._applyFilters();
      this._loadTiles();
    },

    onResetFilters: function () {
      this._mFilters = {
        status: "", category: "", priority: "", priorityGroup: "", assignee: "", team: "", ticketType: "", client: "",
        unassignedOnly: false, assignedOnly: false, excludeClosed: false,
        slaState: "", agingBucket: "", createdDay: "", search: ""
      };
      this.byId("categoryFilter").setSelectedKey("");
      this.byId("priorityFilter").setSelectedKey("");
      this.byId("assigneeFilter").setSelectedKey("");
      this.byId("clientFilter").setSelectedKey("");

      var oDash = this.getView().getModel("dash");
      oDash.setProperty("/tiles", oDash.getProperty("/tiles").map(function (t) {
        t.selected = t.key === "";
        return t;
      }));
      oDash.setProperty("/tableTitle", "All Incidents");
      this._syncTileClasses();
      this._applyFilters();
      this._loadTiles();
    },

    // Clicking a tile filters the table to that status; Total clears it.
    onTilePress: function (oEvent) {
      var oTile = oEvent.getSource().getBindingContext("dash").getObject();
      this._mFilters.status = oTile.key;

      var oDash = this.getView().getModel("dash");
      oDash.setProperty("/tiles", oDash.getProperty("/tiles").map(function (t) {
        t.selected = t.key === oTile.key;
        return t;
      }));
      oDash.setProperty("/tableTitle", oTile.key ? (oTile.label + " Incidents") : "All Incidents");
      this._syncTileClasses();

      this._applyFilters();
    },

    // Ticket type is picked here, before the form even opens — it's fixed
    // for the ticket after this, so the form itself no longer has a
    // Ticket Type field to edit.
    onCreateTicket: function () {
      this.byId("newTicketTypeSelect").setSelectedKey("");
      this.byId("ticketTypeDialog").open();
    },

    onConfirmTicketType: function () {
      var sType = this.byId("newTicketTypeSelect").getSelectedKey();
      if (!sType) {
        MessageToast.show("Please select a ticket type");
        return;
      }
      this.byId("ticketTypeDialog").close();
      this.getOwnerComponent().setPendingTicketType(sType);
      this.getOwnerComponent().getRouter().navTo("create");
    },

    onCancelTicketType: function () {
      this.byId("ticketTypeDialog").close();
    },

    onTicketPress: function (oEvent) {
      var sTicketId = oEvent.getSource().getBindingContext().getProperty("ticketID");
      this.getOwnerComponent().getRouter().navTo("detail", { id: sTicketId });
    },

    onGoDashboard: function () {
      this.getOwnerComponent().getRouter().navTo("dashboard");
    },

    onGoAnalytics: function () {
      this.getOwnerComponent().getRouter().navTo("serviceGroupDashboard");
    },

    // Hides the chart card entirely and hands its width back to the
    // table, instead of leaving a collapsed strip behind.
    onToggleTableExpand: function () {
      this._bChartCollapsed = !this._bChartCollapsed;
      this.byId("chartPane").toggleStyleClass("chartCollapsed", this._bChartCollapsed);

      var oBtn = this.byId("tableExpandBtn");
      oBtn.setIcon(this._bChartCollapsed ? "sap-icon://exit-full-screen" : "sap-icon://full-screen");
      oBtn.setTooltip(this._bChartCollapsed ? "Restore chart" : "Expand table");
    },

    // Own User row (name/email/org) + the persona already known from
    // login — one small read, shown in a popover, nothing navigated to.
    onShowProfile: function (oEvent) {
      var that = this;
      var oSource = oEvent.getSource();
      var oRoleModel = this.getOwnerComponent().getModel("role");
      var sUserId = oRoleModel.getProperty("/userName");
      var sPersona = oRoleModel.getProperty("/persona");
      var oModel = this.getOwnerComponent().getModel();

      oModel.bindList("/Users", undefined, undefined, new Filter("userId", FilterOperator.EQ, sUserId))
        .requestContexts().then(function (aContexts) {
          var oUser = aContexts.length ? aContexts[0].getObject() : {};

          var pOrgName = oUser.client
            ? oModel.bindList("/Organizations", undefined, undefined, new Filter("code", FilterOperator.EQ, oUser.client))
                .requestContexts().then(function (aOrgs) {
                  return aOrgs.length ? aOrgs[0].getObject().name : oUser.client;
                })
            : Promise.resolve("");

          pOrgName.then(function (sOrgName) {
            that.getView().setModel(new JSONModel({
              name: oUser.name || sUserId,
              userId: sUserId,
              email: oUser.email || "",
              roleLabel: PERSONA_LABELS[sPersona] || sPersona,
              organization: sOrgName,
              isActive: oUser.isActive !== false
            }), "profile");
            that.byId("profilePopover").openBy(oSource);
          });
        });
    },

    /* ---------------------------------------------------------
     * "Choose 6 KPI Tiles" — pick exactly TILE_COUNT out of TILE_POOL.
     * Opens with the current selection pre-checked; Save only enables
     * once exactly 6 are checked.
     * ------------------------------------------------------- */
    onManageTiles: function () {
      var aSelectedKeys = this._aTileKeys;
      var aAllTiles = TILE_POOL.map(function (t) {
        return { key: t.key, label: t.label, selected: aSelectedKeys.indexOf(t.key) !== -1 };
      });

      this.getView().setModel(new JSONModel({
        allTiles: aAllTiles,
        selectedCount: aSelectedKeys.length,
        tileCount: TILE_COUNT,
        canSave: aSelectedKeys.length === TILE_COUNT
      }), "tp");

      this.byId("tilePickerDialog").open();
    },

    onTilePickerSelectionChange: function () {
      var oList = this.byId("tilePickerList");
      var oTp = this.getView().getModel("tp");
      var aAllTiles = oTp.getProperty("/allTiles");
      var iSelectedCount = 0;

      oList.getItems().forEach(function (oItem, i) {
        aAllTiles[i].selected = oItem.getSelected();
        if (aAllTiles[i].selected) { iSelectedCount++; }
      });

      oTp.setProperty("/allTiles", aAllTiles);
      oTp.setProperty("/selectedCount", iSelectedCount);
      oTp.setProperty("/canSave", iSelectedCount === TILE_COUNT);
    },

    onSaveTileSelection: function () {
      var aAllTiles = this.getView().getModel("tp").getProperty("/allTiles");
      this._aTileKeys = aAllTiles.filter(function (t) { return t.selected; }).map(function (t) { return t.key; });
      this._saveTileKeyPref(this._aTileKeys);

      this.byId("tilePickerDialog").close();
      this._loadTiles();
    },

    onCancelTileSelection: function () {
      this.byId("tilePickerDialog").close();
    }
  });
});
