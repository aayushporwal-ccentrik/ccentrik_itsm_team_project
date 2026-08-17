const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

const { TicketCounter, User, Organization } = cds.entities("itsm.master");
const { IncidentForm } = cds.entities("itsm.transaction");

// Prefix used in the ticket number, e.g. "INC-00001".
const PREFIX_BY_TYPE = {
  INCIDENT: "INC",
  SERVICE_REQUEST: "SRV",
  CHANGE: "CHG",
  PROBLEM: "PRB"
};

module.exports = cds.service.impl(function () {
  "use strict";

  this.on("currentUser", onCurrentUser);
  this.before("CREATE", "Tickets", onBeforeCreateTicket);
  this.before("UPDATE", "Tickets", onBeforeUpdateTicket);
  this.before("UPDATE", "Organizations", onBeforeUpdateOrganization);
});

// Tells the frontend which persona/theme the logged-in user has.
async function onCurrentUser(req) {
  var sPersona = "END_USER";
  if (req.user.is("Admin")) { sPersona = "ADMIN"; }
  else if (req.user.is("Consultant")) { sPersona = "CONSULTANT"; }
  else if (req.user.is("ServiceGroup")) { sPersona = "SERVICE_GROUP"; }

  return { persona: sPersona, userName: req.user.id, theme: await resolveUserTheme(req.user.id) };
}

async function resolveUserTheme(sUserId) {
  const oUser = await SELECT.one.from(User).where({ userId: sUserId });
  if (!oUser || !oUser.client) { return null; }

  const oOrg = await SELECT.one.from(Organization).where({ code: oUser.client, isActive: true });
  if (!oOrg) { return null; }

  return {
    themeType: oOrg.themeType,
    themeScope: oOrg.themeScope,
    primaryColor: oOrg.primaryColor,
    secondaryColor: oOrg.secondaryColor,
    logo: oOrg.logo
  };
}

// Generates ticketID/ticketNumber and sets the fields that must come
// from the server, not the client.
async function onBeforeCreateTicket(req) {
  const ticket = req.data;
  const identifiers = await generateTicketIdentifiers(ticket.ticketType);

  ticket.ticketID = identifiers.ticketID;
  ticket.ticketNumber = identifiers.ticketNumber;

  ticket.status = ticket.status || "DRAFT";
  ticket.priority = ticket.priority || "MEDIUM";
  ticket.reportedBy = req.user.id;
}

async function onBeforeUpdateTicket(req) {
  if (req.data.messageProcessor) {
    req.data.assignedAt = new Date().toISOString();
  }
  if (req.data.status === "CLOSED") {
    req.data.completedAt = new Date().toISOString();
  }

  // incidentForm fields come in nested under the ticket PATCH; CAP's
  // generic handler can't route that to the child row, so it's applied
  // here as its own update.
  if (req.data.incidentForm) {
    const oFormData = req.data.incidentForm;
    delete oFormData.ID;
    delete oFormData.ticketID;
    delete req.data.incidentForm;

    if (Object.keys(oFormData).length) {
      const [oKey] = req.params;
      await UPDATE(IncidentForm).set(oFormData).where({ ticketID: oKey.ticketID });
    }
  }
}

// User.client is matched against Organization.code by plain string, so
// renaming a code has to carry existing users along with it.
async function onBeforeUpdateOrganization(req) {
  if (!req.data.code) { return; }

  const [oKey] = req.params;
  const oOrg = await SELECT.one.from(Organization).where({ ID: oKey.ID });
  if (oOrg && oOrg.code && oOrg.code !== req.data.code) {
    await UPDATE(User).set({ client: req.data.code }).where({ client: oOrg.code });
  }
}

async function generateTicketIdentifiers(sTicketType) {
  const sType = (sTicketType || "GENERAL").trim().toUpperCase();

  let oCounter = await SELECT.one.from(TicketCounter).where({ type: sType });
  if (!oCounter) {
    oCounter = { type: sType, lastNumber: 1 };
    await INSERT.into(TicketCounter).entries(oCounter);
  } else {
    oCounter.lastNumber++;
    await UPDATE(TicketCounter).set({ lastNumber: oCounter.lastNumber }).where({ type: sType });
  }

  const sPrefix = PREFIX_BY_TYPE[sType] || sType.slice(0, 3);
  const sNumber = sPrefix + "-" + String(oCounter.lastNumber).padStart(5, "0");

  return { ticketID: sNumber, ticketNumber: sNumber };
}
