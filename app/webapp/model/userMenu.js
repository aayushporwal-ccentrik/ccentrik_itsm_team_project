sap.ui.define([
  "sap/ui/core/Fragment",
  "sap/m/MessageToast",
  "itsm/ui/model/auth"
], function (Fragment, MessageToast, auth) {
  "use strict";

  // The header's account popover — current role, the other roles this user
  // can switch to, and Logout. Lives here instead of in each controller so
  // every page only needs one onUserMenu handler. It doubles as the
  // fragment's own controller, which is why the handlers sit on it.
  var oPopover = null;
  var oComponent = null;

  var userMenu = {

    open: function (oController, oSource) {
      oComponent = oController.getOwnerComponent();

      if (oPopover) {
        oPopover.openBy(oSource);
        return;
      }

      Fragment.load({ name: "itsm.ui.view.UserMenu", controller: userMenu }).then(function (oLoaded) {
        oPopover = oLoaded;
        oPopover.setModel(oComponent.getModel("role"), "role");
        oPopover.openBy(oSource);
      });
    },

    onSwitchRole: function (oEvent) {
      var sRole = oEvent.getSource().getBindingContext("role").getProperty("code");
      oPopover.close();

      // Backend re-checks the role against the database and hands back a
      // new token — no password needed while the session is still valid.
      auth.selectRole(sRole).then(function () {
        oComponent.enterApp(sRole);
      }).catch(function (oError) {
        MessageToast.show(oError.message);
      });
    },

    onLogout: function () {
      oPopover.close();
      oComponent.logout();
    }

  };

  return userMenu;
});
