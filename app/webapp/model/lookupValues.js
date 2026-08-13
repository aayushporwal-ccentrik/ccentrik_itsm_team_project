sap.ui.define([], function () {
  "use strict";

  // Reads one lookup type (e.g. "STATUS") from master.LookupValue as
  // {code, name} rows. Used by every screen that needs a filter dropdown,
  // so it lives in one place instead of being copied per controller.
  return function fetchLookup(oModel, sLookupType) {
    return oModel.bindList("/LookupValues", undefined, undefined, undefined, {
      $filter: "lookupType eq '" + sLookupType + "' and isActive eq true",
      $orderby: "sequence"
    }).requestContexts().then(function (aContexts) {
      return aContexts.map(function (oCtx) {
        var o = oCtx.getObject();
        return { code: o.code, name: o.name };
      });
    });
  };
});
