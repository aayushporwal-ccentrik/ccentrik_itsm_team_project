sap.ui.define([], function () {
  "use strict";

  var PRIORITY_STATE = {
    CRITICAL: "Error",
    HIGH: "Warning",
    MEDIUM: "Information",
    LOW: "Success"
  };

  // Shared across controllers so every screen shows dates/priority the same way.
  return {
    formatDateTime: function (vDate) {
      if (!vDate) { return ""; }
      return new Date(vDate).toLocaleString();
    },

    formatPriorityState: function (sPriority) {
      return PRIORITY_STATE[sPriority] || "None";
    }
  };
});
