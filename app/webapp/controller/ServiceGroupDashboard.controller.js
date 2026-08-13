sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "itsm/ui/model/formatter",
  "itsm/ui/model/lookupValues"
], function (Controller, JSONModel, formatter, fetchLookup) {
  "use strict";

  var HIGH_PRIORITY_CODES = ["HIGH", "CRITICAL"];
  var CLOSED_STATUS_CODE = "CLOSED";
  var CHANGE_TICKET_TYPE = "CHANGE";
  var ALL_CLIENTS = "ALL";

  // An engineer with this many overdue tickets or more reads as
  // "Overloaded" instead of "Available". A simple fixed line, not a
  // configurable capacity model — there's nothing in the schema to size
  // it against per engineer.
  var OVERLOAD_OVERDUE_THRESHOLD = 3;

  var CHART_PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#4a3aa7"];
  var TREND_RANGE_DAYS = 14;

  return Controller.extend("itsm.ui.controller.ServiceGroupDashboard", {

    formatPriorityState: formatter.formatPriorityState,

    onInit: function () {
      this._iTrendDays = TREND_RANGE_DAYS;
      this._sSelectedClient = ALL_CLIENTS;
      this.getOwnerComponent().getRouter().getRoute("serviceGroupDashboard").attachPatternMatched(this._onShow, this);
    },

    // Runs after the view is fully on the page, not in onInit. The chart
    // controls are not ready to use yet when onInit runs.
    _onShow: function () {
      if (!this._bChartsReady) {
        this._setupCharts();
        this._bChartsReady = true;
      }
      this._loadStats();
    },

    _setupCharts: function () {
      var oCategoryChart = this.byId("categoryChart");
      var oSlaChart = this.byId("slaChart");
      var oAgingChart = this.byId("agingChart");

      if (oCategoryChart) { oCategoryChart.setVizProperties({ plotArea: { colorPalette: CHART_PALETTE }, legend: { visible: false } }); }
      if (oSlaChart) { oSlaChart.setVizProperties({ plotArea: { colorPalette: ["#16a34a", "#eda100", "#dc2626"] }, legend: { visible: false } }); }
      if (oAgingChart) { oAgingChart.setVizProperties({ plotArea: { colorPalette: CHART_PALETTE }, legend: { visible: false } }); }
    },

    // One read for tickets, plus one small read for users (to resolve each
    // ticket's client via reportedBy) and the CLIENT lookup names — no
    // point making a separate round trip per KPI tile or table.
    _loadStats: function () {
      var that = this;
      var oModel = this.getOwnerComponent().getModel();

      Promise.all([
        oModel.bindList("/Tickets", undefined, undefined, undefined, {
          $select: "ticketID,ticketNumber,status,priority,ticketType,messageProcessor,supportTeam,dueAt,firstResponseAt,completedAt,createdAt,assignedAt,reportedBy",
          $expand: "incidentForm($select=category1)"
        }).requestContexts(),
        oModel.bindList("/Users", undefined, undefined, undefined, { $select: "userId,client" }).requestContexts(),
        fetchLookup(oModel, "CLIENT")
      ]).then(function (aResults) {
        var aTickets = aResults[0].map(function (oCtx) { return oCtx.getObject(); });
        var aUsers = aResults[1].map(function (oCtx) { return oCtx.getObject(); });
        var aClientLookup = aResults[2];

        var mClientByUser = {};
        aUsers.forEach(function (u) { mClientByUser[u.userId] = u.client; });
        aTickets.forEach(function (t) { t.client = mClientByUser[t.reportedBy] || ""; });

        // Every known client, not just ones with tickets today — a client
        // with zero tickets should still be pickable (and correctly show 0s).
        that._aClientOptions = [{ code: ALL_CLIENTS, name: "All" }].concat(
          aClientLookup.map(function (r) { return { code: r.code, name: r.name }; })
        );

        that._aAllTickets = aTickets;
        that._applyClientFilter();
      });
    },

    // "All" keeps the dashboard unfiltered. This is the one place the
    // client filter is applied — every KPI/table/chart below is built from
    // whatever this hands to _buildStats, so nothing else needs to know
    // about client filtering at all.
    _applyClientFilter: function () {
      var sClient = this._sSelectedClient;
      this._aFilteredTickets = sClient === ALL_CLIENTS
        ? this._aAllTickets
        : this._aAllTickets.filter(function (t) { return t.client === sClient; });

      var oStats = this._buildStats(this._aFilteredTickets);
      oStats.selectedClient = sClient;
      oStats.clients = this._aClientOptions;
      this.getView().setModel(new JSONModel(oStats), "ops");
    },

    onClientChange: function (oEvent) {
      this._sSelectedClient = oEvent.getSource().getSelectedKey();
      this._applyClientFilter();
    },

    _buildStats: function (aTickets) {
      var now = new Date();
      var in2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      var open = aTickets.filter(function (t) { return t.status !== CLOSED_STATUS_CODE; });
      var withDue = open.filter(function (t) { return t.dueAt; });
      var overdue = withDue.filter(function (t) { return new Date(t.dueAt) < now; });
      var dueSoon = withDue.filter(function (t) { return new Date(t.dueAt) >= now && new Date(t.dueAt) <= in2h; });
      var resolved = aTickets.filter(function (t) { return t.completedAt; });
      var withResponse = aTickets.filter(function (t) { return t.firstResponseAt; });

      return {
        kpi: {
          totalActive: open.length,
          unassigned: open.filter(function (t) { return !t.messageProcessor; }).length,
          breached: overdue.length,
          dueSoon: dueSoon.length,
          highCritical: open.filter(function (t) { return HIGH_PRIORITY_CODES.indexOf(t.priority) !== -1; }).length,
          changeRequests: open.filter(function (t) { return t.ticketType === CHANGE_TICKET_TYPE; }).length,
          avgResolutionHours: resolved.length
            ? Math.round(resolved.reduce(function (s, t) { return s + (new Date(t.completedAt) - new Date(t.createdAt)); }, 0) / resolved.length / 3600000)
            : 0,
          // Real field presence, not a fabricated per-priority response
          // target: how many tickets have actually been given a first
          // response at all, out of everything ever created.
          firstResponsePercent: aTickets.length ? Math.round((withResponse.length / aTickets.length) * 100) : 0
        },

        workQueue: this._buildWorkQueue(aTickets),
        engineers: this._buildEngineers(open, now),
        slaMonitor: this._buildSlaMonitor(withDue, overdue, dueSoon),
        atRisk: this._buildAtRisk(withDue, now),
        teamPerformance: this._buildTeamPerformance(aTickets),
        categories: this._buildCategories(open),
        aging: this._buildAging(open, now),
        trend: this._buildTrend(aTickets, this._iTrendDays)
      };
    },

    _buildWorkQueue: function (aTickets) {
      var mByStatus = {};
      aTickets.forEach(function (t) { mByStatus[t.status] = (mByStatus[t.status] || 0) + 1; });
      return Object.keys(mByStatus).sort().map(function (s) {
        return { key: s, label: s, count: mByStatus[s] };
      });
    },

    _buildEngineers: function (open, now) {
      var mByEngineer = {};
      open.filter(function (t) { return t.messageProcessor; }).forEach(function (t) {
        var oRow = mByEngineer[t.messageProcessor] || (mByEngineer[t.messageProcessor] = { name: t.messageProcessor, assigned: 0, high: 0, overdue: 0 });
        oRow.assigned++;
        if (HIGH_PRIORITY_CODES.indexOf(t.priority) !== -1) { oRow.high++; }
        if (t.dueAt && new Date(t.dueAt) < now) { oRow.overdue++; }
      });
      return Object.keys(mByEngineer).map(function (k) {
        var oRow = mByEngineer[k];
        oRow.workload = oRow.overdue >= OVERLOAD_OVERDUE_THRESHOLD ? "Overloaded" : "Available";
        oRow.workloadState = oRow.overdue >= OVERLOAD_OVERDUE_THRESHOLD ? "Error" : "Success";
        return oRow;
      }).sort(function (a, b) { return b.assigned - a.assigned; });
    },

    _buildSlaMonitor: function (withDue, overdue, dueSoon) {
      var iWithin = withDue.length - overdue.length - dueSoon.length;
      var iTotal = withDue.length || 1;
      return {
        withinPercent: Math.round((iWithin / iTotal) * 100),
        chartData: [
          { name: "Within SLA", count: Math.max(iWithin, 0) },
          { name: "Due Soon", count: dueSoon.length },
          { name: "Breached", count: overdue.length }
        ]
      };
    },

    _buildAtRisk: function (withDue, now) {
      return withDue
        .filter(function (t) { return !t.completedAt; })
        .sort(function (a, b) { return new Date(a.dueAt) - new Date(b.dueAt); })
        .slice(0, 5)
        .map(function (t) {
          return {
            ticketID: t.ticketID,
            ticketNumber: t.ticketNumber,
            priority: t.priority,
            dueText: new Date(t.dueAt) < now ? "Overdue" : new Date(t.dueAt).toLocaleString()
          };
        });
    },

    _buildTeamPerformance: function (aTickets) {
      var mByTeam = {};
      aTickets.filter(function (t) { return t.supportTeam; }).forEach(function (t) {
        var oRow = mByTeam[t.supportTeam] || (mByTeam[t.supportTeam] = { team: t.supportTeam, total: 0, open: 0, high: 0, resolvedHours: [], onTime: 0, withDue: 0 });
        oRow.total++;
        if (t.status !== CLOSED_STATUS_CODE) { oRow.open++; }
        if (HIGH_PRIORITY_CODES.indexOf(t.priority) !== -1) { oRow.high++; }
        if (t.completedAt) { oRow.resolvedHours.push((new Date(t.completedAt) - new Date(t.createdAt)) / 3600000); }
        if (t.dueAt) {
          oRow.withDue++;
          var bOnTime = t.completedAt ? new Date(t.completedAt) <= new Date(t.dueAt) : new Date(t.dueAt) >= new Date();
          if (bOnTime) { oRow.onTime++; }
        }
      });

      return Object.keys(mByTeam).map(function (k) {
        var oRow = mByTeam[k];
        return {
          team: oRow.team,
          total: oRow.total,
          open: oRow.open,
          high: oRow.high,
          avgResolutionHours: oRow.resolvedHours.length
            ? Math.round(oRow.resolvedHours.reduce(function (s, h) { return s + h; }, 0) / oRow.resolvedHours.length)
            : 0,
          slaPercent: oRow.withDue ? Math.round((oRow.onTime / oRow.withDue) * 100) : 0
        };
      }).sort(function (a, b) { return b.total - a.total; });
    },

    _buildCategories: function (open) {
      var mByCategory = {};
      open.forEach(function (t) {
        var sCode = (t.incidentForm && t.incidentForm.category1) || "Uncategorized";
        mByCategory[sCode] = (mByCategory[sCode] || 0) + 1;
      });
      var iTotal = open.length || 1;
      return Object.keys(mByCategory).map(function (k) {
        return { code: k === "Uncategorized" ? "" : k, name: k, count: mByCategory[k], percent: Math.round((mByCategory[k] / iTotal) * 100) };
      }).sort(function (a, b) { return b.count - a.count; });
    },

    _buildAging: function (open, now) {
      var buckets = [
        { label: "0 - 1 Day", min: 0, max: 1, count: 0 },
        { label: "1 - 3 Days", min: 1, max: 3, count: 0 },
        { label: "3 - 7 Days", min: 3, max: 7, count: 0 },
        { label: "> 7 Days", min: 7, max: Infinity, count: 0 }
      ];
      open.forEach(function (t) {
        var iDays = (now - new Date(t.createdAt)) / 86400000;
        var oBucket = buckets.filter(function (b) { return iDays >= b.min && iDays < b.max; })[0] || buckets[buckets.length - 1];
        oBucket.count++;
      });
      return {
        buckets: buckets.map(function (b) { return { name: b.label, count: b.count }; }),
        over7: buckets[3].count
      };
    },

    // Created vs. Resolved per day, for the last N days.
    _buildTrend: function (aTickets, iDays) {
      var aDays = [];
      var now = new Date();
      for (var i = iDays - 1; i >= 0; i--) {
        var d = new Date(now.getTime() - i * 86400000);
        aDays.push({ key: d.toISOString().slice(0, 10), label: (d.getMonth() + 1) + "/" + d.getDate(), created: 0, resolved: 0 });
      }
      var mByDay = {};
      aDays.forEach(function (d) { mByDay[d.key] = d; });

      aTickets.forEach(function (t) {
        var sCreatedKey = (t.createdAt || "").slice(0, 10);
        if (mByDay[sCreatedKey]) { mByDay[sCreatedKey].created++; }
        var sResolvedKey = (t.completedAt || "").slice(0, 10);
        if (mByDay[sResolvedKey]) { mByDay[sResolvedKey].resolved++; }
      });

      return aDays;
    },

    onTrendRangeChange: function (oEvent) {
      this._iTrendDays = parseInt(oEvent.getSource().getSelectedKey(), 10);
      if (this._aFilteredTickets) {
        this.getView().getModel("ops").setProperty("/trend", this._buildTrend(this._aFilteredTickets, this._iTrendDays));
      }
    },

    onGoDashboard: function () {
      this.getOwnerComponent().getRouter().navTo("serviceGroupDashboard");
    },

    onGoTickets: function () {
      this.getOwnerComponent().getRouter().navTo("dashboard");
    },

    onAtRiskPress: function (oEvent) {
      var sTicketId = oEvent.getSource().getBindingContext("ops").getProperty("ticketID");
      this.getOwnerComponent().getRouter().navTo("detail", { id: sTicketId });
    },

    // Every "go look at these tickets" row below stashes a filter on the
    // Component, then reuses the same ticket table (Dashboard.view.xml)
    // instead of building a separate filtered list per widget. Whatever
    // client is selected here carries over too, so drilling in doesn't
    // silently lose the filter.
    _goToFilteredTickets: function (oFilter) {
      if (this._sSelectedClient && this._sSelectedClient !== ALL_CLIENTS) {
        oFilter.client = this._sSelectedClient;
      }
      this.getOwnerComponent().setPendingTicketFilter(oFilter);
      this.getOwnerComponent().getRouter().navTo("dashboard");
    },

    onWorkQueuePress: function (oEvent) {
      var oRow = oEvent.getSource().getBindingContext("ops").getObject();
      this._goToFilteredTickets({ status: oRow.key, label: oRow.label + " Tickets" });
    },

    // The Engineer Overload table is built from open tickets only (see
    // _buildEngineers), so the filter has to match that — otherwise this
    // would also pull in that engineer's already-closed tickets.
    onEngineerPress: function (oEvent) {
      var oRow = oEvent.getSource().getBindingContext("ops").getObject();
      this._goToFilteredTickets({ assignee: oRow.name, excludeClosed: true, label: oRow.name + "'s Open Tickets" });
    },

    // "View all" on the Engineer Overload card — same set of tickets the
    // card itself was built from (assigned + open), not literally every
    // ticket including unassigned/closed ones.
    onViewAllEngineersPress: function () {
      this._goToFilteredTickets({ assignedOnly: true, excludeClosed: true, label: "Assigned Open Tickets" });
    },

    // Team Performance shows both Total and Open counts, so an unfiltered
    // (all-status) view for the team matches the Total column.
    onTeamPress: function (oEvent) {
      var oRow = oEvent.getSource().getBindingContext("ops").getObject();
      this._goToFilteredTickets({ team: oRow.team, label: oRow.team + " Tickets" });
    },

    // Top Categories is built from open tickets only (see _buildCategories).
    onCategoryPress: function (oEvent) {
      var oRow = oEvent.getSource().getBindingContext("ops").getObject();
      this._goToFilteredTickets({ category: oRow.code, excludeClosed: true, label: oRow.name + " Open Tickets" });
    },

    onUnassignedTilePress: function () {
      this._goToFilteredTickets({ unassignedOnly: true, excludeClosed: true, label: "Unassigned Tickets" });
    },

    onSlaBreachedTilePress: function () {
      this._goToFilteredTickets({ slaState: "breached", label: "SLA Breached Tickets" });
    },

    onSlaDueSoonTilePress: function () {
      this._goToFilteredTickets({ slaState: "dueSoon", label: "SLA Due Soon Tickets" });
    },

    // Clicking a slice of the SLA donut shows just those tickets.
    onSlaChartSelect: function (oEvent) {
      var aData = oEvent.getParameter("data");
      if (!aData || !aData.length) { return; }

      var sBucket = aData[0].data.Bucket;
      var mStateByBucket = { "Breached": "breached", "Due Soon": "dueSoon", "Within SLA": "withinSla" };
      var sSlaState = mStateByBucket[sBucket];
      if (!sSlaState) { return; }

      this._goToFilteredTickets({ slaState: sSlaState, label: sBucket + " Tickets" });
    },

    // Clicking a slice of the Aging donut shows tickets that old. Aging is
    // built from open tickets only (see _buildAging), so exclude closed here too.
    onAgingChartSelect: function (oEvent) {
      var aData = oEvent.getParameter("data");
      if (!aData || !aData.length) { return; }

      var sLabel = aData[0].data.Bucket;
      var mBucketByLabel = { "0 - 1 Day": "0-1", "1 - 3 Days": "1-3", "3 - 7 Days": "3-7", "> 7 Days": "7+" };
      var sBucket = mBucketByLabel[sLabel];
      if (!sBucket) { return; }

      this._goToFilteredTickets({ agingBucket: sBucket, excludeClosed: true, label: sLabel + " Old Tickets" });
    },

    // Clicking a point on the trend line shows tickets created that day.
    // The chart only carries the "Day" label (e.g. "8/12"); look up the
    // matching entry in the trend model to get its real date key.
    onTrendChartSelect: function (oEvent) {
      var aData = oEvent.getParameter("data");
      if (!aData || !aData.length) { return; }

      var sDayLabel = aData[0].data.Day;
      var aTrend = this.getView().getModel("ops").getProperty("/trend") || [];
      var oDay = aTrend.filter(function (d) { return d.label === sDayLabel; })[0];
      if (!oDay) { return; }

      this._goToFilteredTickets({ createdDay: oDay.key, label: "Tickets Created " + sDayLabel });
    },

    // All KPI tiles below count open tickets only (see _buildStats' kpi
    // block), so every filter here needs excludeClosed to match its count.
    onTotalActiveTilePress: function () {
      this._goToFilteredTickets({ excludeClosed: true, label: "All Active Tickets" });
    },

    onHighCriticalTilePress: function () {
      this._goToFilteredTickets({ priorityGroup: "highCritical", excludeClosed: true, label: "High/Critical Priority Tickets" });
    },

    onChangeRequestsTilePress: function () {
      this._goToFilteredTickets({ ticketType: "CHANGE", excludeClosed: true, label: "Change Requests" });
    }
  });
});
