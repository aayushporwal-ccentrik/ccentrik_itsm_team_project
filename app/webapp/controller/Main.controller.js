sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/model/json/JSONModel",
  "sap/m/MessageToast",
  "sap/m/MessageBox",
  "sap/base/Log",
  "itsm/ui/model/roleConfig",
  "itsm/ui/model/formatter"
], function (Controller, JSONModel, MessageToast, MessageBox, Log, getTicketFormUiModel, formatter) {
  "use strict";

  var UPDATE_GROUP = "incidentGroup";

  // oFile.type (browser MIME sniffing) is unreliable for Office documents:
  // legacy .doc is frequently reported as "" and .docx (a zip container) can
  // come back as "" or "application/zip" on systems without those types
  // registered. Fall back to extension-based lookup covering the formats
  // this form already advertises as supported.
  var EXTENSION_MIME_TYPES = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    eml: "message/rfc822",
    msg: "application/vnd.ms-outlook"
  };

  return Controller.extend("itsm.ui.controller.Main", {

    onInit: function () {
      this.getView().setModel(new JSONModel({}), "ui");
      this.getView().setModel(new JSONModel({ list: [], countLabel: "0 files" }), "attachments");

      var oRouter = this.getOwnerComponent().getRouter();
      oRouter.getRoute("create").attachPatternMatched(this._onCreate, this);
      oRouter.getRoute("detail").attachPatternMatched(this._onDetail, this);
    },

    // Starts a brand new ticket as a Draft. Nothing is sent to the server
    // yet — the model's updateGroupId is a named batch group (see
    // manifest.json), so the create just sits in the local cache until
    // Save (or Submit) sends it. The server assigns ticketID and
    // ticketNumber on insert (see srv/service.js), not the client.
    _onCreate: function () {
      // If this route matches again before a previous visit's create was
      // ever saved (e.g. "New Ticket" pressed twice, or navigating back to
      // /create), the earlier context is still sitting in the same batch
      // group, still transient (never sent). Left alone, it rides along on
      // the NEXT submitBatch (Save/Submit) as a second, blank ticket — the
      // form only shows the latest context, so that first one silently
      // saves with whatever it had at creation time (i.e. nothing typed
      // yet, not even a ticket type) instead of what the user actually
      // filled in. Discarding it here means at most one pending create
      // ever exists at a time.
      if (this._oPendingCreateContext && this._oPendingCreateContext.isTransient()) {
        this._oPendingCreateContext.delete();
      }

      this._bCreateMode = true;
      this._bEditing = true;

      var oListBinding = this.getView().getModel().bindList("/Tickets");
      var oContext = oListBinding.create({
        status: "DRAFT",
        reportedBy: this._getUserName(),
        incidentForm: {}
      });
      this._oPendingCreateContext = oContext;

      this.getView().setBindingContext(oContext);
      this.getView().getModel("attachments").setData({ list: [], countLabel: "0 files" });
      this._refreshUiModel("DRAFT");
    },

    // One request for the ticket, its incident form and its attachments —
    // the composition is already in the schema, so $expand gets everything
    // the form needs in one round trip instead of a separate attachments call.
    _onDetail: function (oEvent) {
      this._bCreateMode = false;
      this._bEditing = false;

      var sId = oEvent.getParameter("arguments").id;
      var oContext = this.getView().getModel().bindContext(
        "/Tickets(ticketID='" + sId + "')",
        undefined,
        { $expand: "incidentForm,attachments" }
      ).getBoundContext();

      this.getView().setBindingContext(oContext);

      var that = this;
      oContext.requestObject().then(function (oTicket) {
        that._refreshUiModel(oTicket.status);
        that._setAttachmentsModel(oTicket.attachments, oContext);
      });
    },

    // Persona comes from the server (see Component.js / srv/service.js
    // currentUser()). The actual role → flags mapping lives in
    // model/roleConfig.js, not here — this just feeds it the current
    // state and stores the result.
    _refreshUiModel: function (sStatus) {
      var sPersona = this.getOwnerComponent().getModel("role").getProperty("/persona");
      var oUiModel = getTicketFormUiModel(sPersona, !!this._bCreateMode, !!this._bEditing, sStatus);
      this.getView().getModel("ui").setData(oUiModel);
    },

    onEdit: function () {
      this._bEditing = true;
      this._refreshUiModel(this.getView().getBindingContext().getProperty("status"));
    },

    // First save of a brand new ticket creates it as Draft and shows the
    // generated ticket number; saving an already-open ticket (Service
    // Group / Consultant editing) just persists the changes.
    onSave: function () {
      var that = this;
      var oContext = this.getView().getBindingContext();
      var bWasCreating = this._bCreateMode;

      var pSaved = this.getView().getModel().submitBatch(UPDATE_GROUP);
      if (bWasCreating) {
        pSaved = pSaved.then(function () { return oContext.created(); });
      }

      pSaved.then(function () {
        if (bWasCreating) {
          that._oPendingCreateContext = null;
          var sNumber = oContext.getProperty("ticketNumber");
          MessageBox.information("Ticket " + sNumber + " has been created and saved as Draft.", {
            onClose: function () {
              that.getOwnerComponent().getRouter().navTo("detail", { id: oContext.getProperty("ticketID") }, true);
            }
          });
        } else {
          that._bEditing = false;
          that._refreshUiModel(oContext.getProperty("status"));
          MessageToast.show("Ticket saved");
        }
      }).catch(function (oError) {
        // Logged, not just shown as a generic toast — otherwise "request
        // never sent" and "request sent, server rejected it" look identical
        // from the outside, which is exactly what made an earlier bug here
        // hard to pin down.
        Log.error("Ticket save failed", oError);
        MessageBox.error("Could not save the ticket. Please check the required fields.");
      });
    },

    // Moves the ticket straight to New — either a brand new ticket that
    // was never saved as Draft, or an existing Draft opened later.
    onSubmit: function () {
      var that = this;
      var oViewContext = this.getView().getBindingContext();
      var bWasCreating = this._bCreateMode;

      // An existing ticket is read via _onDetail with $expand=incidentForm,
      // attachments (one round trip for the whole form) — the v4 model
      // carries that same $expand into any PATCH built from that context,
      // asking the server to return incidentForm re-expanded in the write
      // response. IncidentForm isn't separately exposed as its own entity
      // set (db/schema.cds / srv/service.cds), so CAP rejects the whole
      // write with "Entity ITSMService.IncidentForm is not explicitly
      // exposed as part of the service" — even for a plain status change
      // with no incidentForm data involved. A second, expand-free context
      // bound to the same key sidesteps it for the write; it shares the
      // same underlying cache entry as the view's own context, so the
      // change still shows up on screen.
      var oContext = bWasCreating
        ? oViewContext
        : this.getView().getModel().bindContext(oViewContext.getPath()).getBoundContext();

      oContext.setProperty("status", "NEW");

      var pSaved = this.getView().getModel().submitBatch(UPDATE_GROUP);
      if (bWasCreating) {
        pSaved = pSaved.then(function () { return oContext.created(); });
      }

      pSaved.then(function () {
        if (bWasCreating) { that._oPendingCreateContext = null; }
        MessageBox.success("Your ticket has been submitted.", {
          onClose: function () { that._navHome(); }
        });
      }).catch(function (oError) {
        Log.error("Ticket submit failed", oError);
        MessageBox.error("Could not submit the ticket. Please check the required fields.");
      });
    },

    onDelete: function () {
      var that = this;
      MessageBox.confirm("Delete this ticket? This cannot be undone.", {
        onClose: function (sAction) {
          if (sAction !== MessageBox.Action.OK) { return; }
          var oModel = that.getView().getModel();
          var pDeleted = that.getView().getBindingContext().delete(UPDATE_GROUP);
          // delete() only queues the request on incidentGroup — it's an API
          // group (see manifest.json), so nothing is actually sent until
          // submitBatch flushes it, same as onSave/onSubmit already do.
          oModel.submitBatch(UPDATE_GROUP);
          pDeleted.then(function () {
            MessageToast.show("Ticket deleted");
            that.getOwnerComponent().getRouter().navTo("dashboard");
          }).catch(function (oError) {
            Log.error("Ticket delete failed", oError);
            MessageBox.error("Could not delete the ticket.");
          });
        }
      });
    },

    onBack: function () {
      this._navHome();
    },

    onGoDashboard: function () {
      this._navHome();
    },

    // Consultant's home is their own assigned queue, not the shared dashboard.
    _navHome: function () {
      var sPersona = this.getOwnerComponent().getModel("role").getProperty("/persona");
      var sRoute = sPersona === "CONSULTANT" ? "assigned" : "dashboard";
      this.getOwnerComponent().getRouter().navTo(sRoute);
    },

    // Sub Status belongs to whichever Status is picked now, so drop the old
    // one whenever Status changes instead of leaving a stale pairing.
    onStatusChange: function () {
      this.getView().getBindingContext().setProperty("subStatus", null);
    },

    onTabSelect: function (oEvent) {
      var oSectionByKey = {
        general: "secGeneral",
        processing: "secProcessing",
        relationships: "secRelationships",
        attachments: "secAttachments"
      };
      var oSection = this.byId(oSectionByKey[oEvent.getParameter("key")]);
      if (oSection && oSection.getDomRef()) {
        oSection.getDomRef().scrollIntoView({ behavior: "smooth" });
      }
    },

    onFileSelected: function (oEvent) {
      var aFiles = Array.prototype.slice.call(oEvent.getParameter("files") || []);
      if (!aFiles.length) { return; }

      var oTicketContext = this.getView().getBindingContext();
      var oModel = this.getView().getModel();
      var that = this;

      // oAttContext.created() never resolves for an attachment created while
      // the parent Ticket is itself still unsaved (deep-insert case) — the
      // child gets folded into the parent's single create request instead of
      // getting one of its own, and afterwards its context keeps a stale
      // transient ($uid=...) identity that fails to drill down for any
      // property. Wait on the batch itself, then read the real, server-
      // assigned IDs back off oTicketContext (a plain top-level property
      // read, which does resolve correctly) instead of the child context.
      aFiles.forEach(function (oFile) {
        oModel.bindList("attachments", oTicketContext).create({
          fileName: oFile.name,
          mediaType: that._resolveMimeType(oFile),
          fileSize: oFile.size
        });
      });

      oModel.submitBatch(UPDATE_GROUP).then(function () {
        var sTicketId = oTicketContext.getProperty("ticketID");
        var aSaved = (oTicketContext.getObject() || {}).attachments || [];
        aFiles.forEach(function (oFile) {
          var oSaved = aSaved.filter(function (o) {
            return o.fileName === oFile.name && o.fileSize === oFile.size;
          }).pop();
          if (!oSaved) {
            MessageBox.error("Could not upload " + oFile.name + ".");
            return;
          }
          that._uploadContent(sTicketId, oSaved.ID, oFile)
            .then(function () { that._refreshAttachments(oTicketContext); })
            .catch(function () { MessageBox.error("Could not upload " + oFile.name + "."); });
        });
      });
    },

    // Attachment is only reachable through the Ticket's "attachments" nav
    // property (CAP rejects a direct top-level path to it), so the delete
    // path has to be built relative to the ticket context, not absolute.
    onAttachmentRemove: function (oEvent) {
      var sId = oEvent.getSource().getBindingContext("attachments").getProperty("id");
      var oTicketContext = this.getView().getBindingContext();
      var oModel = this.getView().getModel();
      var that = this;

      var pDeleted = oModel.bindContext("attachments(ID='" + sId + "')", oTicketContext).getBoundContext().delete(UPDATE_GROUP);
      oModel.submitBatch(UPDATE_GROUP);
      pDeleted
        .then(function () { that._refreshAttachments(oTicketContext); })
        .catch(function (oError) {
          Log.error("Attachment remove failed", oError);
          MessageBox.error("Could not remove the attachment.");
        });
    },

    // Re-reads the attachments list after an upload or a remove. This one
    // is a real extra request (the data just changed), unlike the initial
    // load which comes for free via $expand in _onDetail.
    _refreshAttachments: function (oTicketContext) {
      var that = this;
      this.getView().getModel().bindList("attachments", oTicketContext).requestContexts()
        .then(function (aContexts) {
          that._setAttachmentsModel(aContexts.map(function (oCtx) { return oCtx.getObject(); }), oTicketContext);
        });
    },

    _setAttachmentsModel: function (aAttachments, oTicketContext) {
      var that = this;
      var sBase = this._getServiceUrl() + oTicketContext.getPath().replace(/^\//, "") + "/attachments";

      var aList = (aAttachments || []).map(function (oAtt) {
        return {
          id: oAtt.ID,
          fileName: oAtt.fileName,
          uploadedBy: oAtt.createdBy,
          uploadedOn: that.formatDateTime(oAtt.createdAt),
          contentUrl: sBase + "(ID='" + oAtt.ID + "')/content"
        };
      });

      this.getView().getModel("attachments").setData({
        list: aList,
        countLabel: aList.length + (aList.length === 1 ? " file" : " files")
      });
    },

    _uploadContent: function (sTicketId, sAttId, oFile) {
      var sUrl = this._getServiceUrl() + "Tickets('" + encodeURIComponent(sTicketId) + "')/attachments(ID='" + sAttId + "')/content";
      return fetch(sUrl, {
        method: "PUT",
        headers: { "Content-Type": this._resolveMimeType(oFile) },
        body: oFile,
        credentials: "same-origin"
      });
    },

    _resolveMimeType: function (oFile) {
      if (oFile.type) { return oFile.type; }
      var sExt = (oFile.name.split(".").pop() || "").toLowerCase();
      return EXTENSION_MIME_TYPES[sExt] || "application/octet-stream";
    },

    _getServiceUrl: function () {
      return this.getOwnerComponent().getManifestEntry("sap.app").dataSources.incidentService.uri;
    },

    _getUserName: function () {
      return this.getOwnerComponent().getModel("role").getProperty("/userName");
    },

    formatDateTime: formatter.formatDateTime,

    // No real SLA target data exists yet (priority has no defined response
    // time), so this just reflects where the ticket is in its lifecycle.
    formatSlaText: function (sPriority, sCreatedAt, sFirstResponseAt, sCompletedAt) {
      if (sCompletedAt) { return "Completed"; }
      if (sFirstResponseAt) { return "First response given"; }
      return sPriority ? "Awaiting first response" : "Awaiting assessment";
    },

    formatSlaState: function (sPriority, sCreatedAt, sFirstResponseAt, sCompletedAt) {
      if (sCompletedAt) { return "Success"; }
      if (sFirstResponseAt) { return "Warning"; }
      return "None";
    }
  });
});
