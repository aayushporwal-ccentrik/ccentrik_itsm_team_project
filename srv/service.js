const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;

const { TicketCounter } = cds.entities("itsm.master");
const { IncidentForm } = cds.entities("itsm.transaction");

// Short code shown in the ticket number, e.g. "INC-00001". Falls back to
// the type's own first 3 letters if it's not in this list.
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
});

// Tells the frontend which persona the logged-in user is (see
// webapp/model/roleConfig.js) — CAP has no built-in "whoami" endpoint.
async function onCurrentUser(req) {
  var sPersona = "END_USER";
  if (req.user.is("Consultant")) { sPersona = "CONSULTANT"; }
  else if (req.user.is("ServiceGroup")) { sPersona = "SERVICE_GROUP"; }

  return { persona: sPersona, userName: req.user.id };
}

// Assigns a ticket its key (ticketID) and its human-readable number
// (ticketNumber) the moment it's first saved, and fills in the fields
// that should always come from the server, not the client.
async function onBeforeCreateTicket(req) {
  const ticket = req.data;
  const identifiers = await generateTicketIdentifiers(ticket.ticketType);

  ticket.ticketID = identifiers.ticketID;
  ticket.ticketNumber = identifiers.ticketNumber;

  ticket.status = ticket.status || "DRAFT";
  ticket.priority = ticket.priority || "MEDIUM";

  // The server decides who reported the ticket — never trust the client for this.
  ticket.reportedBy = req.user.id;
}

// Two timestamps the server sets on its own, not the client:
// - assignedAt: the moment someone is put in Message Processor.
// - completedAt: the moment the ticket is moved to Closed.
async function onBeforeUpdateTicket(req) {
  if (req.data.messageProcessor) {
    req.data.assignedAt = new Date().toISOString();
  }
  if (req.data.status === "CLOSED") {
    req.data.completedAt = new Date().toISOString();
  }

  // The form edits incidentForm fields via flat paths (e.g. "incidentForm/system"),
  // never through its own bound entity, so the client's PATCH nests them
  // inside the ticket payload without the child row's own key. The generic
  // handler can't address that and silently drops it, so it's applied here
  // as its own update instead, matched by ticketID (one form per ticket).
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
