const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const nodemailer = require("nodemailer");
const { buildConfirmationEmailTemplate, buildServiceGroupEmailTemplate, buildAssignmentEmailTemplate } = require("./email-templates");
const { sendEmailSafe } = require("./ticket-helpers");
const { Ticket, IncidentForm, TicketLog } = cds.entities("itsm.transaction");
const { TicketCounter, User, Organization } = cds.entities("itsm.master");
 
// Prefix used in the ticket number, e.g. "INC-00001".
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
  this.on("ticketAction", onticketAction);
  this.before("CREATE", "Tickets", onBeforeCreateTicket);
  this.before("UPDATE", "Tickets", onBeforeUpdateTicket);
  this.before("UPDATE", "Organizations", onBeforeUpdateOrganization);
});

 
async function onticketAction(req) {
 
    const { ticketID, action } = req.data;

    const tx = cds.tx(req);

    if (!ticketID) {
        return req.error(400, "Ticket ID is required");
    }
 
    if (!action) {
        return req.error(400, "Action is required");
    }

    // Each action belongs to exactly one persona — a Consultant can't
    // SUBMIT, a Service Group can't RESOLVE, etc.
    const ROLE_BY_ACTION = {
        SUBMIT: "EndUser",
        ASSIGN: "ServiceGroup",
        RESOLVED: "Consultant",
        CLOSED: "EndUser"
    };
    const requiredRole = ROLE_BY_ACTION[action];
    if (requiredRole && !req.user.is(requiredRole)) {
        return req.error(403, `Only ${requiredRole} can perform action '${action}'`);
    }

    try {
 
        // =====================================================
        // GET TICKET
        // =====================================================
 
        const ticket = await tx.run(
            SELECT.one.from(Ticket).where({
                ticketID: ticketID
            })
        );
 
        if (!ticket) {
            return req.error(404, `Ticket ${ticketID} not found`);
        }
 
 
        // =====================================================
        // SUBMIT
        // =====================================================
 
        if (action === "SUBMIT") {
 
            const now = new Date();
 
            // Original user who created/submitted the ticket
            const userId = req.user?.id;
 
            const currentUser = userId
                ? await tx.run(
                    SELECT.one.from(User).where({
                        userId: userId
                    })
                )
                : null;
 
            const originalUserName =
                currentUser?.name ||
                ticket.createdByName ||
                "Unknown User";
 
            const originalUserEmail =
                currentUser?.email ||
                null;
 
 
            // -------------------------------------------------
            // Update Ticket
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(Ticket)
                    .set({
                        status: "NEW",
                        subStatus: "PENDING",
                        pendingWith: "Service Group",
                        pendingWithName: "Service Group"
                    })
                    .where({
                        ticketID: ticketID
                    })
            );
 
 
            // -------------------------------------------------
            // Create workflow logs
            // -------------------------------------------------
 
            await tx.run(
                INSERT.into(TicketLog).entries([
 
                    // 1. Initiator
                    {
                        ticketID: ticketID,
                        SrNo: 1,
                        stage: "Initiator",
                        status: "Completed",
                        userName: originalUserName,
                        userEmail: originalUserEmail,
                        role: "Agent",
                        receivedDt: ticket.createdAt || now,
                        completionDt: now,
                        remarks: "Ticket initiated and submitted."
                    },
 
                    // 2. Service Group
                    {
                        ticketID: ticketID,
                        SrNo: 2,
                        stage: "Service Group",
                        status: "Pending",
                        userName: null,
                        userEmail: null,
                        role: "ServiceGroup",
                        receivedDt: now,
                        completionDt: null,
                        remarks: "Ticket is pending with Service Group."
                    },
 
                    // 3. Consultant
                    {
                        ticketID: ticketID,
                        SrNo: 3,
                        stage: "Consultant",
                        status: "Not Started Yet",
                        userName: null,
                        userEmail: null,
                        role: "Consultant",
                        receivedDt: null,
                        completionDt: null,
                        remarks: "Ticket is waiting for Consultant assignment."
                    },
 
                    // 4. Resolved
                    // IMPORTANT:
                    // Store original requester details here itself.
                    {
                        ticketID: ticketID,
                        SrNo: 4,
                        stage: "Resolved",
                        status: "Not Started Yet",
                        userName: originalUserName,
                        userEmail: originalUserEmail,
                        role: "Agent",
                        receivedDt: null,
                        completionDt: null,
                        remarks: "Resolution stage has not started yet."
                    }
 
                ])
            );
 
 
            // -------------------------------------------------
            // Send mail to Service Group + confirmation to submitter
            // -------------------------------------------------

            // Re-fetch so the email reflects the just-updated status/subStatus
            const updatedTicket = await tx.run(
                SELECT.one.from(Ticket).where({ ticketID })
            );

            const serviceGroupUsers = await tx.run(
                SELECT.from(User).where({ role: "SERVICE_GROUP", isActive: true })
            );

            if (serviceGroupUsers.length) {
                await sendEmailSafe(transporter, {
                    from: process.env.MAIL_FROM,
                    to: serviceGroupUsers.map(u => u.email),
                    subject: `New Ticket Submitted — ${updatedTicket.ticketNumber}`,
                    html: buildServiceGroupEmailTemplate(updatedTicket)
                });
            } else {
                console.warn("No active Service Group user found to notify");
            }

            if (originalUserEmail) {
                await sendEmailSafe(transporter, {
                    from: process.env.MAIL_FROM,
                    to: originalUserEmail,
                    subject: `Your ticket ${updatedTicket.ticketNumber} has been submitted`,
                    html: buildConfirmationEmailTemplate(updatedTicket)
                });
            } else {
                console.warn("Submitter email not found, confirmation mail skipped");
            }

            return `Ticket ${ticketID} submitted successfully`;
        }
 
 
        // =====================================================
        // ASSIGN
        // =====================================================
 
        if (action === "ASSIGN") {
 
            /*
             * consultantId is NOT coming from req.data.
             *
             * The selected Consultant is expected to already
             * be stored in Ticket.messageProcessor.
             */
 
            const consultantId = ticket.messageProcessor;
 
            if (!consultantId) {
                return req.error(
                    400,
                    "No Consultant selected for this ticket."
                );
            }
 
 
            // -------------------------------------------------
            // Get selected Consultant
            // -------------------------------------------------
 
            const consultant = await tx.run(
                SELECT.one.from(User).where({
                    userId: consultantId
                })
            );
 
            if (!consultant) {
                return req.error(
                    404,
                    `Consultant ${consultantId} not found`
                );
            }
 
            const now = new Date();
 
 
            // -------------------------------------------------
            // Get current Service Group user
            // -------------------------------------------------
 
            const serviceGroupUserId = req.user?.id;
 
            const serviceGroupUser = serviceGroupUserId
                ? await tx.run(
                    SELECT.one.from(User).where({
                        userId: serviceGroupUserId
                    })
                )
                : null;
 
 
            // -------------------------------------------------
            // Service Group log → Completed
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(TicketLog)
                    .set({
                        status: "Completed",
                        completionDt: now,
                        userName: serviceGroupUser?.name,
                        userEmail: serviceGroupUser?.email,
                        role: "ServiceGroup",
                        remarks: `Ticket assigned to Consultant ${consultant.name}.`
                    })
                    .where({
                        ticketID: ticketID,
                        stage: "Service Group"
                    })
            );
 
 
            // -------------------------------------------------
            // Consultant log → Pending
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(TicketLog)
                    .set({
                        status: "Pending",
                        receivedDt: now,
                        userName: consultant.name,
                        userEmail: consultant.email,
                        role: "Consultant",
                        remarks: "Ticket assigned to Consultant."
                    })
                    .where({
                        ticketID: ticketID,
                        stage: "Consultant"
                    })
            );
 
 
            // -------------------------------------------------
            // Update Ticket
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(Ticket)
                    .set({
                        messageProcessor: consultant.userId,
                        pendingWith: "Consultant",
                        pendingWithName: consultant.name,
                        status: "ASSIGNED",
                        subStatus: "IN_PROGRESS",
                        assignedAt: now
                    })
                    .where({
                        ticketID: ticketID
                    })
            );
 
 
            // -------------------------------------------------
            // Send mail to Consultant
            // -------------------------------------------------

            const updatedTicket = await tx.run(
                SELECT.one.from(Ticket).where({ ticketID })
            );

            if (consultant.email) {
                await sendEmailSafe(transporter, {
                    from: process.env.MAIL_FROM,
                    to: consultant.email,
                    subject: `Ticket Assigned — ${updatedTicket.ticketNumber}`,
                    html: buildAssignmentEmailTemplate(updatedTicket, consultant.name)
                });
            } else {
                console.warn("Consultant email not found, assignment mail skipped");
            }

            return `Ticket ${ticketID} assigned to ${consultant.name}`;
        }
 
 
        // =====================================================
        // RESOLVED
        // =====================================================
 
        if (action === "RESOLVED") {
 
            if (ticket.status !== "ASSIGNED") {
                return req.error(
                    400,
                    `Ticket cannot be resolved from status ${ticket.status}`
                );
            }
 
            const now = new Date();
 
 
            // -------------------------------------------------
            // Get original requester
            // -------------------------------------------------
 
            const originalUser = ticket.reportedBy
                ? await tx.run(
                    SELECT.one.from(User).where({
                        userId: ticket.reportedBy
                    })
                )
                : null;
 
 
            // -------------------------------------------------
            // Get Consultant
            // -------------------------------------------------
 
            const consultant = ticket.messageProcessor
                ? await tx.run(
                    SELECT.one.from(User).where({
                        userId: ticket.messageProcessor
                    })
                )
                : null;
 
 
            // -------------------------------------------------
            // Consultant log → Completed
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(TicketLog)
                    .set({
                        status: "Completed",
                        completionDt: now,
                        userName: consultant?.name,
                        userEmail: consultant?.email,
                        role: "Consultant",
                        remarks: "Consultant resolved the ticket."
                    })
                    .where({
                        ticketID: ticketID,
                        stage: "Consultant"
                    })
            );
 
 
            // -------------------------------------------------
            // Resolved log → Pending
            //
            // IMPORTANT:
            // Original requester details were already stored
            // during SUBMIT.
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(TicketLog)
                    .set({
                        status: "Pending",
                        receivedDt: now,
                        role: "Agent",
                        remarks: "Ticket resolved and waiting for requester confirmation."
                    })
                    .where({
                        ticketID: ticketID,
                        stage: "Resolved"
                    })
            );
 
 
            // -------------------------------------------------
            // Update Ticket
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(Ticket)
                    .set({
                        status: "RESOLVED",
                        subStatus: "PENDING",
                        pendingWith: "Agent",
                        pendingWithName:
                            originalUser?.name ||
                            ticket.createdByName,
                        completedAt: now
                    })
                    .where({
                        ticketID: ticketID
                    })
            );
 
 
            // -------------------------------------------------
            // TODO: Send mail to original requester
            // -------------------------------------------------
 
            // await sendMailToRequester({
            //     requester: originalUser,
            //     ticket
            // });
 
 
            return `Ticket ${ticketID} resolved successfully`;
        }
 
 
        // =====================================================
        // CLOSED
        // =====================================================
 
        if (action === "CLOSED") {
 
            if (ticket.status !== "RESOLVED") {
                return req.error(
                    400,
                    `Ticket cannot be closed from status ${ticket.status}`
                );
            }
 
            const now = new Date();
 
 
            // -------------------------------------------------
            // Close all workflow logs
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(TicketLog)
                    .set({
                        status: "Closed",
                        completionDt: now
                    })
                    .where({
                        ticketID: ticketID
                    })
            );
 
 
            // -------------------------------------------------
            // Close Ticket
            // -------------------------------------------------
 
            await tx.run(
                UPDATE(Ticket)
                    .set({
                        status: "CLOSED",
                        subStatus: "COMPLETED",
                        pendingWith: null,
                        pendingWithName: null
                    })
                    .where({
                        ticketID: ticketID
                    })
            );
 
 
            // -------------------------------------------------
            // TODO: Send final mail
            // -------------------------------------------------
 
            // await sendClosureMail(ticket);
 
 
            return `Ticket ${ticketID} closed successfully`;
        }
        // INVALID ACTION
        return req.error(
            400,
            `Unsupported action: ${action}`
        );
    } catch (error) {
 
        console.error(
            `Error performing ${action} on ticket ${ticketID}:`,
            error
        );
 
        return req.error(
            500,
            `Failed to perform ${action}: ${error.message}`
        );
    }
}
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
async function onBeforeCreateTicket(req) {
  const ticket = req.data;
  const identifiers = await generateTicketIdentifiers(ticket.ticketType);
 
  ticket.ticketID = identifiers.ticketID;
  ticket.ticketNumber = identifiers.ticketNumber;
  ticket.status = ticket.status || "DRAFT";
  ticket.priority = ticket.priority || "MEDIUM";
  ticket.reportedBy = req.user.id;
  ticket.createdByName = req.user.id;
}
async function onBeforeUpdateTicket(req) {
  if (req.data.messageProcessor) {
    req.data.assignedAt = new Date().toISOString();
  }
  if (req.data.status === "CLOSED") {
    req.data.completedAt = new Date().toISOString();
  }
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
 
 