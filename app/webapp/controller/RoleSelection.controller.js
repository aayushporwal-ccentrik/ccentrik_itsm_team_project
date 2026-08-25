sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "itsm/ui/model/auth"
], function (Controller, auth) {
  "use strict";

  return Controller.extend("itsm.ui.controller.RoleSelection", {

    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("selectRole").attachPatternMatched(this._onShow, this);
    },

    // The roles model is filled by Component.onLoggedIn from the login
    // response. Reaching this page any other way (refresh, bookmark) means
    // there is nothing to pick from, so start over at login.
    _onShow: function () {
      var oModel = this.getOwnerComponent().getModel("roleSelect");
      if (!oModel || !oModel.getProperty("/roles").length) {
        this.getOwnerComponent().getRouter().navTo("login");
      }
    },

    onSelectRole: function (oEvent) {
      var that = this;
      var sRole = oEvent.getSource().getBindingContext("roleSelect").getProperty("code");

      this.byId("roleError").setVisible(false);
      oEvent.getSource().setBusy(true);

      auth.selectRole(sRole).then(function () {
        oEvent.getSource().setBusy(false);
        that.getOwnerComponent().enterApp(sRole);
      }).catch(function (oError) {
        oEvent.getSource().setBusy(false);
        that.byId("roleError").setText(oError.message);
        that.byId("roleError").setVisible(true);
      });
    },

    onLogout: function () {
      this.getOwnerComponent().logout();
    }

  });
});
