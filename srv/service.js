const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const nodemailer = require("nodemailer");
const { buildConfirmationEmailTemplate, buildServiceGroupEmailTemplate, buildAssignmentEmailTemplate } = require("./email-templates");
const { updateTicketStatus, createTimelineLog, completePendingLog, sendEmailSafe } = require("./ticket-helpers");
const { Ticket, IncidentForm, TicketLog } = cds.entities("itsm.transaction");
const { TicketCounter, User } = cds.entities("itsm.master");

const PREFIX_BY_TYPE = {
  INCIDENT: "INC",
  SERVICE_REQUEST: "SRV",
  CHANGE: "CHG",
  PROBLEM: "PRB"
};

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
module.exports = cds.service.impl(function () {
  "use strict";

  this.on("currentUser", onCurrentUser);
  this.before("CREATE", "Tickets", onBeforeCreateTicket);
  this.before("UPDATE", "Tickets", onBeforeUpdateTicket);
  this.on("submitTicket", "Tickets", onSubmitTicket);
  this.on("assignTicket", "Tickets", onAssignTicket);
});
async function onCurrentUser(req) {
  var sPersona = "END_USER";
  if (req.user.is("Consultant")) { sPersona = "CONSULTANT"; }
  else if (req.user.is("ServiceGroup")) { sPersona = "SERVICE_GROUP"; }
  return { persona: sPersona, userName: req.user.id };
}
async function onBeforeCreateTicket(req) {
  const ticket = req.data;
  const identifiers = await generateTicketIdentifiers(ticket.ticketType);

  ticket.ticketID = identifiers.ticketID;
  ticket.ticketNumber = identifiers.ticketNumber;
  ticket.status = ticket.status || "DRAFT";
  ticket.createdByName = req.user.id;
}
async function onBeforeUpdateTicket(req) {
  if (req.data.incidentForm) {
    const oFormData = req.data.incidentForm;
    delete oFormData.ID;
    delete oFormData.ticketID;
    delete req.data.incidentForm;

    if (Object.keys(oFormData).length) {
      const [oKey] = req.params;
      const ticketID = oKey.ticketID;

      const existingForm = await SELECT.one.from(IncidentForm).where({ ticketID });

      if (existingForm) {
        await UPDATE(IncidentForm).set(oFormData).where({ ticketID });
      } else {
        await INSERT.into(IncidentForm).entries({ ticketID, ...oFormData });
      }
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
async function onSubmitTicket(req) {
    const ticketID = req.params[0].ticketID;

    try {
        await updateTicketStatus(ticketID, { status: "SUBMITTED", subStatus: "NEW" });
        const ticket = await SELECT.one.from(Ticket).where({ ticketID });
        const serviceGroupUsers = await SELECT.from(User)
            .where({ role: "SERVICE_GROUP", isActive: true });

        const now = new Date().toISOString();
        await createTimelineLog({
            ticketID,
            stage: "SUBMITTED",
            status: "COMPLETED",
            userName: req.user.id,
            userEmail: req.user.email,
            role: "EndUser",
            receivedDt: now,
            completionDt: now
        });

        if (serviceGroupUsers.length) {
            await sendEmailSafe(transporter, {
                from: process.env.MAIL_FROM,
                to: serviceGroupUsers.map(u => u.email),
                subject: `New Ticket Submitted — ${ticket.ticketNumber}`,
                html: buildServiceGroupEmailTemplate(ticket)
            });
        } else {
            console.warn("No active Service Group user found to notify");
        }

        if (req.user.email) {
            await sendEmailSafe(transporter, {
                from: process.env.MAIL_FROM,
                to: req.user.email,
                subject: `Your ticket ${ticket.ticketNumber} has been submitted`,
                html: buildConfirmationEmailTemplate(ticket)
            });
        } else {
            console.warn("Submitter email not found, confirmation mail skipped");
        }

        return { success: true, message: "Ticket submitted successfully" };

    } catch (error) {
        console.error("Submit failed:", error);
        return req.error(500, "Failed to submit ticket");
    }
}
async function onAssignTicket(req) {
    const ticketID = req.params[0].ticketID;
    const messageProcessor = req.data.messageProcessor;

    try {
        const ticket = await SELECT.one.from(Ticket).where({ ticketID });
        if (!ticket) {
            return req.error(404, "Ticket not found");
        }

        // Step 2: Consultant fetch + validate (the user being assigned, from the request)
        const consultant = await SELECT.one.from(User).where({ userId: messageProcessor });
        if (!consultant) {
            return req.error(400, "Assigned consultant not found");
        }
       // Step 3: Ticket status + messageProcessor update
        await updateTicketStatus(ticketID, {
            status: "ASSIGNED",
            subStatus: "IN_PROGRESS",
            messageProcessor: messageProcessor
        });

        const now = new Date().toISOString();

        // Step 4: Timeline log — ASSIGNED (event, completed immediately)
        await createTimelineLog({
            ticketID,
            stage: "ASSIGNED",
            status: "COMPLETED",
            userName: req.user.id,
            userEmail: req.user.email,
            role: "ServiceGroup",
            receivedDt: now,
            completionDt: now,
            pendingWith: consultant.userId,
            pendingWithName: consultant.name
        });

        // Step 5: Timeline log — CONSULTANT_WORK 
        await createTimelineLog({
            ticketID,
            stage: "CONSULTANT_WORK",
            status: "PENDING",
            pendingWith: consultant.userId,
            pendingWithName: consultant.name
        });

        // Step 6: Notify the consultant
        await sendEmailSafe(transporter, {
            from: process.env.MAIL_FROM,
            to: consultant.email,
            subject: `Ticket Assigned — ${ticket.ticketNumber}`,
            html: buildAssignmentEmailTemplate(ticket, consultant.name)
        });
        return { success: true, message: "Ticket assigned successfully" };

    } catch (error) {
        console.error("Assign failed:", error);
        return req.error(500, "Failed to assign ticket");
    }
}