sap.ui.define([], function () {
  "use strict";

  // Every field, spelled out true/false for each persona. Read this table
  // to know the rule for a field — no boolean math to trace through, and
  // no field is ever left out (so a binding can never resolve to "undefined").
  var ROLE_CONFIG = {

    END_USER: {
      // End User can only edit while creating a new ticket.
      activeWhen: "create",
      visibility: {
        assign: false,
        processing: false,
        priority: false,
        recommendedPriority: true,
        technical: false,
        status: false,
        subStatus: false
      },
      editable: {
        supportTeam: false,
        messageProcessor: false,
        category1: true,
        category2: true,
        category3: true,
        category4: true,
        solutionCategory: false,
        shortDescription: true,
        status: false,
        subStatus: false,
        impact: true,
        urgency: true,
        priority: false,
        firstResponseAt: false,
        dueAt: false,
        relatedRFC: false,
        configurationItem: false,
        fullDescription: true,
        system: false,
        softwareComponent: false,
        softwareVersion: false,
        supportPackage: false,
        irtStatus: false,
        mptStatus: false,
        workingArea: false,
        isSapRelated: false,
        attachments: true
      }
    },

    SERVICE_GROUP: {
      // Service Group edits once they open a ticket to assess/assign it.
      activeWhen: "editing",
      visibility: {
        assign: true,
        processing: true,
        priority: true,
        recommendedPriority: false,
        technical: false,
        status: true,
        subStatus: true
      },
      editable: {
        supportTeam: true,
        messageProcessor: true,
        category1: true,
        category2: true,
        category3: true,
        category4: true,
        solutionCategory: true,
        shortDescription: false,
        status: false,
        subStatus: false,
        impact: true,
        urgency: true,
        priority: true,
        firstResponseAt: true,
        dueAt: true,
        relatedRFC: false,
        configurationItem: false,
        fullDescription: false,
        system: false,
        softwareComponent: false,
        softwareVersion: false,
        supportPackage: false,
        irtStatus: false,
        mptStatus: false,
        workingArea: false,
        isSapRelated: false,
        attachments: false
      }
    },

    CONSULTANT: {
      // Consultant edits once they open an assigned ticket to work it.
      activeWhen: "editing",
      visibility: {
        assign: false,
        processing: true,
        priority: true,
        recommendedPriority: false,
        technical: true,
        status: true,
        subStatus: true
      },
      editable: {
        supportTeam: false,
        messageProcessor: false,
        category1: false,
        category2: false,
        category3: false,
        category4: false,
        solutionCategory: false,
        shortDescription: false,
        status: true,
        subStatus: true,
        impact: false,
        urgency: false,
        priority: false,
        firstResponseAt: false,
        dueAt: false,
        relatedRFC: true,
        configurationItem: true,
        fullDescription: true,
        system: true,
        softwareComponent: true,
        softwareVersion: true,
        supportPackage: true,
        irtStatus: true,
        mptStatus: true,
        workingArea: true,
        isSapRelated: true,
        // View/download only here — the Consultant works with evidence the
        // End User already provided, not a new upload flow.
        attachments: false
      }
    }
  };

  // Combines the static table above with where the ticket is right now
  // (being created, opened for edit, or sitting as a Draft) into the
  // flags the view binds to.
  return function getTicketFormUiModel(sPersona, bCreate, bEditing, sStatus) {
    var oConfig = ROLE_CONFIG[sPersona] || ROLE_CONFIG.END_USER;
    var bDraft = sStatus === "DRAFT";
    // End User's ticket stays theirs to edit for as long as it's a Draft —
    // whether that's the initial create session (bCreate) or reopening the
    // same Draft later from the Dashboard (bCreate is false then, only
    // bDraft is true) — Submit is what finally locks it, not navigating away.
    var bActive = oConfig.activeWhen === "create" ? (bCreate || bDraft) : bEditing;

    var oEditable = {};
    Object.keys(oConfig.editable).forEach(function (sField) {
      oEditable[sField] = oConfig.editable[sField] && bActive;
    });

    return {
      isCreate: bCreate,
      visibility: oConfig.visibility,
      editable: oEditable,

      // Header buttons — workflow state, not a form field, so kept separate.
      // Save creates the ticket as Draft; Submit moves it straight to New
      // (either from the create form directly, or from a Draft opened later).
      // Delete: only End User, and only while the ticket is still a Draft
      // (not submitted yet) — once it's New or later, it can't be deleted.
      showBack: true,
      showDelete: sPersona === "END_USER" && bDraft,
      showEdit: sPersona !== "END_USER" && !bCreate && !bEditing && !bDraft,
      showSave: bActive,
      showSubmit: bCreate || (sPersona === "END_USER" && bDraft),
      saveLabel: "Save",
      saveEnabled: true,

      // The four lifecycle actions (see srv/service.js ticketAction) —
      // each shown only to the persona who owns that step, only once the
      // ticket is actually at that step.
      showAssign: sPersona === "SERVICE_GROUP" && bEditing && sStatus === "NEW",
      showResolve: sPersona === "CONSULTANT" && bEditing && sStatus === "ASSIGNED",
      showClose: sPersona === "END_USER" && sStatus === "RESOLVED",

      subtitle: bCreate ? "Create a new incident ticket" : ""
    };
  };
});
