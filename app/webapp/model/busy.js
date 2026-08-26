sap.ui.define([], function () {
  "use strict";

  // Shows a busy overlay on oControl (a View or a Button) until pAction settles.
  // The overlay also blocks clicks underneath it, so this doubles as a double-click guard.
  return {
    withBusy: function (oControl, pAction) {
      oControl.setBusy(true);
      return pAction.finally(function () { oControl.setBusy(false); });
    }
  };
});
