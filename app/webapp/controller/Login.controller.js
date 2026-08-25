sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "itsm/ui/model/auth"
], function (Controller, auth) {
  "use strict";

  // One controller for all three auth routes — the view swaps between a
  // sign-in, forgot-password and reset-password block (see Login.view.xml).
  var BLOCKS = ["loginBlock", "forgotBlock", "resetBlock"];

  return Controller.extend("itsm.ui.controller.Login", {

    onInit: function () {
      var oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("login").attachPatternMatched(this._onShowLogin, this);
      oRouter.getRoute("forgotPassword").attachPatternMatched(this._onShowForgot, this);
      oRouter.getRoute("resetPassword").attachPatternMatched(this._onShowReset, this);
    },

    _showBlock: function (sId) {
      var that = this;
      BLOCKS.forEach(function (sBlock) {
        that.byId(sBlock).setVisible(sBlock === sId);
      });
    },

    // ===== Sign in =====

    // Landing here always means starting over — drop whatever token was
    // left behind, so a half-finished login can't linger.
    _onShowLogin: function () {
      auth.clearSession();
      this._showBlock("loginBlock");
      this.byId("loginError").setVisible(false);
      this.byId("loginPassword").setValue("");
    },

    onLogin: function () {
      var that = this;
      var sEmail = this.byId("loginEmail").getValue().trim();
      var sPassword = this.byId("loginPassword").getValue();

      if (!sEmail || !sPassword) {
        return this._showError("Please enter your email and password.");
      }

      this.byId("loginError").setVisible(false);
      this.byId("loginButton").setBusy(true);

      auth.login(sEmail, sPassword).then(function (oData) {
        that.byId("loginButton").setBusy(false);
        that.getOwnerComponent().onLoggedIn(oData);
      }).catch(function (oError) {
        that.byId("loginButton").setBusy(false);
        that._showError(oError.message);
      });
    },

    onForgotPassword: function () {
      this.getOwnerComponent().getRouter().navTo("forgotPassword");
    },

    _showError: function (sMessage) {
      this.byId("loginError").setText(sMessage);
      this.byId("loginError").setVisible(true);
    },

    // ===== Forgot password =====

    _onShowForgot: function () {
      this._showBlock("forgotBlock");
      this.byId("forgotMessage").setVisible(false);
      this.byId("forgotEmail").setValue("");
    },

    onSendResetLink: function () {
      var that = this;
      var sEmail = this.byId("forgotEmail").getValue().trim();

      if (!sEmail) {
        return this._showForgotMessage("Error", "Please enter your email address.");
      }

      this.byId("forgotButton").setBusy(true);

      // The reply is the same whether or not the address exists, so there
      // is nothing here to branch on.
      auth.forgotPassword(sEmail).then(function (oData) {
        that.byId("forgotButton").setBusy(false);
        that._showForgotMessage("Success", oData.message);
      }).catch(function (oError) {
        that.byId("forgotButton").setBusy(false);
        that._showForgotMessage("Error", oError.message);
      });
    },

    onBackToLogin: function () {
      this.getOwnerComponent().getRouter().navTo("login");
    },

    _showForgotMessage: function (sType, sMessage) {
      this.byId("forgotMessage").setType(sType);
      this.byId("forgotMessage").setText(sMessage);
      this.byId("forgotMessage").setVisible(true);
    },

    // ===== Reset password =====

    // The token comes straight out of the URL the email linked to.
    _onShowReset: function (oEvent) {
      this._sToken = oEvent.getParameter("arguments").token;
      this._showBlock("resetBlock");
      this.byId("resetMessage").setVisible(false);
      this.byId("resetForm").setVisible(true);
      this.byId("goToLoginButton").setVisible(false);
      this.byId("backToLoginLink").setVisible(true);
      this.byId("newPassword").setValue("");
      this.byId("confirmPassword").setValue("");
    },

    onResetPassword: function () {
      var that = this;
      var sPassword = this.byId("newPassword").getValue();
      var sConfirm = this.byId("confirmPassword").getValue();

      if (sPassword.length < 8) {
        return this._showResetMessage("Error", "Password must be at least 8 characters.");
      }
      if (sPassword !== sConfirm) {
        return this._showResetMessage("Error", "Passwords do not match.");
      }

      this.byId("resetButton").setBusy(true);

      auth.resetPassword(this._sToken, sPassword, sConfirm).then(function (oData) {
        that.byId("resetButton").setBusy(false);
        that.byId("resetForm").setVisible(false);
        that.byId("backToLoginLink").setVisible(false);
        that.byId("goToLoginButton").setVisible(true);
        that._showResetMessage("Success", oData.message);
      }).catch(function (oError) {
        that.byId("resetButton").setBusy(false);
        that._showResetMessage("Error", oError.message);
      });
    },

    _showResetMessage: function (sType, sMessage) {
      this.byId("resetMessage").setType(sType);
      this.byId("resetMessage").setText(sMessage);
      this.byId("resetMessage").setVisible(true);
    }

  });
});
