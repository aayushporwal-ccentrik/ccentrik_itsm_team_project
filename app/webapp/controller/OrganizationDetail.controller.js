sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/m/MessageToast",
  "sap/base/Log",
  "sap/ui/unified/ColorPickerPopover",
  "itsm/ui/model/formatter"
], function (Controller, Filter, FilterOperator, MessageToast, Log, ColorPickerPopover, formatter) {
  "use strict";

  var UPDATE_GROUP = "incidentGroup";

  // The real header displays the logo at a fixed HEIGHT only (see .appLogo/
  // .themePreviewLogo) — width scales to whatever the image's own aspect
  // ratio is. So there's no actual requirement the crop output be wide; a
  // square or tall logo just renders narrower in the header, which is fine.
  // Offering shapes instead of forcing one fixed rectangle is the direct
  // fix for "horizontal shape ki wajah se use nahi kar pa raha".
  var CROP_SHAPES = {
    WIDE: { w: 320, h: 100 },
    SQUARE: { w: 200, h: 200 },
    TALL: { w: 160, h: 220 }
  };

  // ColorPickerPopover returns "rgb(r,g,b)" when a color is picked via the
  // slider/swatch area (only its own hex sub-field gives back "#rrggbb"
  // directly) — normalize to hex so storage/display/validation downstream
  // only ever have to deal with one format.
  function rgbToHex(sColor) {
    var aMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(sColor || "");
    if (!aMatch) { return sColor; }
    return "#" + aMatch.slice(1, 4).map(function (sChannel) {
      var sHex = parseInt(sChannel, 10).toString(16);
      return sHex.length === 1 ? "0" + sHex : sHex;
    }).join("");
  }

  return Controller.extend("itsm.ui.controller.OrganizationDetail", {

    formatThemePreviewHtml: formatter.formatThemePreviewHtml,

    onInit: function () {
      this.getOwnerComponent().getRouter().getRoute("organizationDetail").attachPatternMatched(this._onShow, this);
    },

    _onShow: function (oEvent) {
      var sId = oEvent.getParameter("arguments").id;
      var oModel = this.getOwnerComponent().getModel();
      var oContext = oModel.bindContext("/Organizations(ID='" + sId + "')").getBoundContext();

      this.getView().setBindingContext(oContext);

      var that = this;
      oContext.requestObject().then(function (oOrg) {
        that._filterUsersByClient(oOrg.code);
      });
    },

    // Users aren't a real association to Organization (see plan — client
    // stays the same free-text match used everywhere else in the app), so
    // the table is filtered by code once the org context resolves, same
    // "set up after context loads" shape Main.controller.js already uses
    // for attachments.
    _filterUsersByClient: function (sCode) {
      this._sOrgCode = sCode;
      this.byId("orgUsersTable").getBinding("items").filter([new Filter("client", FilterOperator.EQ, sCode)]);
    },

    onBack: function () {
      this.getOwnerComponent().getRouter().navTo("organizations");
    },

    onSaveDetails: function () {
      this.getOwnerComponent().getModel().submitBatch(UPDATE_GROUP).then(function () {
        MessageToast.show("Organization details saved.");
      });
    },

    onSaveTheme: function () {
      this.getOwnerComponent().getModel().submitBatch(UPDATE_GROUP).then(function () {
        MessageToast.show("Theme saved.");
      });
    },

    // A picked file doesn't upload immediately — it opens the crop dialog
    // first (see onLogoCropDialogAfterOpen/_drawCrop below). This is the
    // direct fix for "logo displays too small": most logo source images
    // have far more empty margin than actual mark, so a fixed-height
    // header render (see .appLogo/.themePreviewLogo, both height:~20-30px)
    // shrinks the visible mark to almost nothing. Cropping lets the admin
    // fill the frame with just the part that should actually be shown.
    onLogoFileSelected: function (oEvent) {
      var aFiles = oEvent.getParameter("files");
      if (!aFiles || !aFiles.length) { return; }

      this._oPendingLogoFile = aFiles[0];
      this._oCropShape = CROP_SHAPES.WIDE;
      var that = this;
      var oImg = new Image();
      oImg.onload = function () {
        that._oCropImage = oImg;
        that._fCropZoom = 1;
        that._fitCropToShape();
        that.byId("logoCropShape").setSelectedKey("WIDE");
        that.byId("logoCropZoom").setValue(1);
        that.byId("logoCropDialog").open();
      };
      oImg.src = URL.createObjectURL(this._oPendingLogoFile);
    },

    onLogoCropDialogAfterOpen: function () {
      this._oCropCanvas = document.getElementById("logoCropCanvas");
      this._oCropCtx = this._oCropCanvas.getContext("2d");
      this._resizeCropCanvas();
      this._drawCrop();
      this._attachCropDragHandlers();
    },

    onLogoCropDialogAfterClose: function () {
      if (this._fnCropCleanup) { this._fnCropCleanup(); this._fnCropCleanup = null; }
      if (this._oCropImage) { URL.revokeObjectURL(this._oCropImage.src); this._oCropImage = null; }
    },

    onLogoCropShapeChange: function (oEvent) {
      this._oCropShape = CROP_SHAPES[oEvent.getParameter("key")] || CROP_SHAPES.WIDE;
      this._fCropZoom = 1;
      this.byId("logoCropZoom").setValue(1);
      this._fitCropToShape();
      this._resizeCropCanvas();
      this._drawCrop();
    },

    // Canvas width/height are attributes, not CSS — resizing via CSS alone
    // would stretch the existing bitmap instead of giving more actual pixels
    // to draw into, so the element itself is resized whenever the shape does.
    _resizeCropCanvas: function () {
      this._oCropCanvas.width = this._oCropShape.w;
      this._oCropCanvas.height = this._oCropShape.h;
    },

    // Scale "covers" the frame completely (no letterboxing) — same idea as
    // CSS object-fit:cover — then centers it. Shared by the initial file
    // load and by switching shapes later, so both fit the same way.
    _fitCropToShape: function () {
      var img = this._oCropImage;
      var oShape = this._oCropShape;
      this._fCropBaseScale = Math.max(oShape.w / img.width, oShape.h / img.height);
      this._oCropOffset = {
        x: (oShape.w - img.width * this._fCropBaseScale) / 2,
        y: (oShape.h - img.height * this._fCropBaseScale) / 2
      };
    },

    _drawCrop: function () {
      var ctx = this._oCropCtx;
      var img = this._oCropImage;
      var oShape = this._oCropShape;
      var fScale = this._fCropBaseScale * this._fCropZoom;

      ctx.clearRect(0, 0, oShape.w, oShape.h);
      ctx.drawImage(img, this._oCropOffset.x, this._oCropOffset.y, img.width * fScale, img.height * fScale);
    },

    // Plain pointer events, not a UI5 control — the canvas is raw HTML (see
    // the view), UI5 has no built-in crop/drag control to bind this to.
    _attachCropDragHandlers: function () {
      var that = this;
      var canvas = this._oCropCanvas;
      var bDragging = false;
      var oStart = null;
      var oOffsetStart = null;

      function onDown(oEvt) {
        bDragging = true;
        oStart = { x: oEvt.clientX, y: oEvt.clientY };
        oOffsetStart = { x: that._oCropOffset.x, y: that._oCropOffset.y };
      }
      function onMove(oEvt) {
        if (!bDragging) { return; }
        that._oCropOffset = {
          x: oOffsetStart.x + (oEvt.clientX - oStart.x),
          y: oOffsetStart.y + (oEvt.clientY - oStart.y)
        };
        that._drawCrop();
      }
      function onUp() { bDragging = false; }

      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);

      this._fnCropCleanup = function () {
        canvas.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    },

    // Keeps whatever point is currently at the frame's center still at the
    // center after the zoom changes, instead of zooming from the top-left
    // corner (which would immediately drag the image out of frame).
    onLogoCropZoomChange: function (oEvent) {
      var fNewZoom = oEvent.getParameter("value");
      var oShape = this._oCropShape;
      var fOldScale = this._fCropBaseScale * this._fCropZoom;
      var fNewScale = this._fCropBaseScale * fNewZoom;
      var fFocalX = (oShape.w / 2 - this._oCropOffset.x) / fOldScale;
      var fFocalY = (oShape.h / 2 - this._oCropOffset.y) / fOldScale;

      this._fCropZoom = fNewZoom;
      this._oCropOffset = {
        x: oShape.w / 2 - fFocalX * fNewScale,
        y: oShape.h / 2 - fFocalY * fNewScale
      };
      this._drawCrop();
    },

    onApplyLogoCrop: function () {
      var that = this;
      var sMediaType = this._oPendingLogoFile.type || "image/png";
      this._oCropCanvas.toBlob(function (oBlob) {
        that.byId("logoCropDialog").close();
        that._uploadLogo(oBlob, that._oPendingLogoFile.name, sMediaType);
      }, sMediaType);
    },

    onCancelLogoCrop: function () {
      this.byId("logoCropDialog").close();
    },

    // Same upload mechanism as Main.controller.js's ticket attachments:
    // metadata (name/media type) saved first via the OData model, then the
    // raw bytes PUT directly to the LargeBinary property's own stream URL —
    // logoContent is a plain CAP media property, no custom handler needed.
    // "logo" (the field everything else reads) is only updated at the end,
    // once the upload has actually succeeded, and cache-busted with a query
    // param so re-uploading a new file doesn't keep showing the old one
    // from the browser's image cache at that same URL.
    _uploadLogo: function (oBlob, sFileName, sMediaType) {
      var oContext = this.getView().getBindingContext();
      var oModel = this.getOwnerComponent().getModel();
      var that = this;

      oContext.setProperty("logoFileName", sFileName);
      oContext.setProperty("logoMediaType", sMediaType);

      oModel.submitBatch(UPDATE_GROUP)
        .then(function () { return that._uploadLogoContent(oContext, oBlob, sMediaType); })
        .then(function () {
          oContext.setProperty("logo", that._getServiceUrl() + oContext.getPath().replace(/^\//, "") + "/logoContent?v=" + Date.now());
          return oModel.submitBatch(UPDATE_GROUP);
        })
        .then(function () { MessageToast.show("Logo uploaded."); })
        .catch(function (oError) {
          Log.error("Logo upload failed", oError);
          MessageToast.show("Could not upload logo.");
        });
    },

    _uploadLogoContent: function (oContext, oBlob, sMediaType) {
      var sUrl = this._getServiceUrl() + oContext.getPath().replace(/^\//, "") + "/logoContent";
      return fetch(sUrl, {
        method: "PUT",
        headers: { "Content-Type": sMediaType || "image/png" },
        body: oBlob,
        credentials: "same-origin"
      });
    },

    _getServiceUrl: function () {
      return this.getOwnerComponent().getManifestEntry("sap.app").dataSources.incidentService.uri;
    },

    onRemoveLogo: function () {
      var oContext = this.getView().getBindingContext();
      oContext.setProperty("logo", null);
      this.getOwnerComponent().getModel().submitBatch(UPDATE_GROUP);
    },

    // One popover reused for both fields, opened by whichever palette
    // button was pressed — colorString is only read on open (to seed the
    // picker) and written back through the same bound field on change, so
    // the live preview updates immediately without a separate "apply" step.
    // The change handler re-reads the view's binding context each time
    // (not captured once) — this popover instance outlives a single org,
    // so a stale captured context would misfire after navigating org A's
    // detail page -> org B's.
    _openColorPicker: function (oButton, sField) {
      var that = this;
      var oContext = this.getView().getBindingContext();

      if (!this._oColorPopover) {
        this._oColorPopover = new ColorPickerPopover({
          change: function (oEvent) {
            that.getView().getBindingContext().setProperty(that._sColorField, rgbToHex(oEvent.getParameter("colorString")));
          }
        });
      }
      this._sColorField = sField;
      this._oColorPopover.setColorString(oContext.getProperty(sField) || "#2a78d6");
      this._oColorPopover.openBy(oButton);
    },

    onPickPrimaryColor: function (oEvent) {
      this._openColorPicker(oEvent.getSource(), "primaryColor");
    },

    onPickSecondaryColor: function (oEvent) {
      this._openColorPicker(oEvent.getSource(), "secondaryColor");
    },

    onUserRoleChange: function () {
      this.getOwnerComponent().getModel().submitBatch(UPDATE_GROUP).then(function () {
        MessageToast.show("Role updated.");
      });
    },

    onToggleUserActive: function () {
      this.getOwnerComponent().getModel().submitBatch(UPDATE_GROUP).then(function () {
        MessageToast.show("Status updated.");
      });
    },

    onAddUser: function () {
      this.byId("newUserId").setValue("");
      this.byId("newUserName").setValue("");
      this.byId("newUserEmail").setValue("");
      this.byId("newUserRole").setSelectedKey("END_USER");
      this.byId("addUserDialog").open();
    },

    onSaveUser: function () {
      var sUserId = this.byId("newUserId").getValue().trim();
      var sName = this.byId("newUserName").getValue().trim();
      if (!sUserId || !sName) {
        MessageToast.show("Username and Name are required.");
        return;
      }

      var oModel = this.getOwnerComponent().getModel();
      var that = this;
      var oContext = oModel.bindList("/Users").create({
        userId: sUserId,
        name: sName,
        email: this.byId("newUserEmail").getValue().trim(),
        role: this.byId("newUserRole").getSelectedKey(),
        isActive: true,
        client: this._sOrgCode
      });

      oContext.created().then(function () {
        that.byId("addUserDialog").close();
        MessageToast.show("User created. Provision their login separately.");
        that.byId("orgUsersTable").getBinding("items").refresh();
      }).catch(function (oError) {
        Log.error("User create failed", oError);
        MessageToast.show("Could not create user.");
      });

      // Same miss as Organizations.controller.js's onSaveOrganization had:
      // create() only queues the request, submitBatch is what actually
      // sends it — without this the Create button silently does nothing.
      oModel.submitBatch(UPDATE_GROUP);
    },

    onCancelAddUser: function () {
      this.byId("addUserDialog").close();
    }
  });
});
