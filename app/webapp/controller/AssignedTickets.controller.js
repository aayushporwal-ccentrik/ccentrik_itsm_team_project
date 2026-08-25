sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "itsm/ui/model/lookupValues",
  "itsm/ui/model/formatter",
  "itsm/ui/model/userMenu"
], function (Controller, JSONModel, Filter, FilterOperator, fetchLookup, formatter, userMenu) {
  "use strict";

  return Controller.extend("itsm.ui.controller.AssignedTickets", {
    // Header account popover: current role, role switch, logout.
    onUserMenu: function (oEvent) {
      userMenu.open(this, oEvent.getSource());
    },

    formatDateTime: formatter.formatDateTime,

    onInit: function () {
      this._mFilters = { status: "", priority: "", search: "" };
      this.getOwnerComponent().getRouter().getRoute("assigned").attachPatternMatched(this._onShow, this);
    },

    _onShow: function () {
      if (!this._bFiltersLoaded) {
        this._buildFiltersModel();
        this._bFiltersLoaded = true;
      }
      this._applyFilters();
    },

    _buildFiltersModel: function () {
      var oModel = this.getOwnerComponent().getModel();
      var oFiltersModel = new JSONModel({
        statuses: [{ code: "", name: "All Statuses" }],
        priorities: [{ code: "", name: "All Priorities" }]
      });
      this.getView().setModel(oFiltersModel, "filters");

      fetchLookup(oModel, "STATUS").then(function (aRows) {
        oFiltersModel.setProperty("/statuses", [{ code: "", name: "All Statuses" }].concat(aRows));
      });
      fetchLookup(oModel, "PRIORITY").then(function (aRows) {
        oFiltersModel.setProperty("/priorities", [{ code: "", name: "All Priorities" }].concat(aRows));
      });
    },

    // This page is the Consultant's own queue, so it only ever shows
    // tickets assigned to them.
    _applyFilters: function () {
      var sMyName = this.getOwnerComponent().getModel("role").getProperty("/userName");
      var aFilters = [new Filter("messageProcessor", FilterOperator.EQ, sMyName)];

      if (this._mFilters.status) {
        aFilters.push(new Filter("status", FilterOperator.EQ, this._mFilters.status));
      }
      if (this._mFilters.priority) {
        aFilters.push(new Filter("priority", FilterOperator.EQ, this._mFilters.priority));
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

      // filter() alone skips re-fetching when the new filters equal the
      // ones already applied — refresh() forces a real re-fetch so a
      // ticket assigned since the last visit actually shows up.
      var oBinding = this.byId("assignedTable").getBinding("items");
      oBinding.filter(aFilters);
      oBinding.refresh();
    },

    onFilterChange: function () {
      this._mFilters.status = this.byId("assignedStatusFilter").getSelectedKey();
      this._mFilters.priority = this.byId("assignedPriorityFilter").getSelectedKey();
      this._applyFilters();
    },

    onSearch: function (oEvent) {
      this._mFilters.search = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
      this._applyFilters();
    },

    onResetFilters: function () {
      this._mFilters = { status: "", priority: "", search: "" };
      this.byId("assignedStatusFilter").setSelectedKey("");
      this.byId("assignedPriorityFilter").setSelectedKey("");
      this._applyFilters();
    },

    onTicketPress: function (oEvent) {
      var sTicketId = oEvent.getSource().getBindingContext().getProperty("ticketID");
      this.getOwnerComponent().getRouter().navTo("detail", { id: sTicketId });
    },

    onGoAssigned: function () {
      this.getOwnerComponent().getRouter().navTo("assigned");
    }
  });
});
