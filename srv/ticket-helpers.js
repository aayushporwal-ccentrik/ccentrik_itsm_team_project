const cds = require("@sap/cds");
const { SELECT, INSERT, UPDATE } = cds.ql;
const { Ticket, TicketLog } = cds.entities("itsm.transaction");

// Updates one or more fields on the Ticket entity (status, subStatus, messageProcessor, etc.)
async function updateTicketStatus(ticketID, fields) {
    await UPDATE(Ticket).set(fields).where({ ticketID });
}
async function createTimelineLog({
    ticketID,
    stage,
    status,
    userName,
    userEmail,
    role,
    receivedDt,
    completionDt,
    pendingWith,
    pendingWithName,
    remarks
}) {
    await INSERT.into(TicketLog).entries({
        ticketID,
        stage,
        status,
        userName: userName || null,
        userEmail: userEmail || null,
        role: role || null,
        receivedDt: receivedDt || null,
        completionDt: completionDt || null,
        pendingWith: pendingWith || null,
        pendingWithName: pendingWithName || null,
        remarks: remarks || null
    });
}
// Finds the most recent PENDING log of a given stage for a ticket, and marks it COMPLETED.
async function completePendingLog(ticketID, stage) {
    const pendingLog = await SELECT.one.from(TicketLog)
        .where({ ticketID, stage, status: "PENDING" });

    if (pendingLog) {
        await UPDATE(TicketLog)
            .set({ status: "COMPLETED", completionDt: new Date().toISOString() })
            .where({ ID: pendingLog.ID });
    }
    return pendingLog;
}
async function sendEmailSafe(transporter, mailOptions) {
    try {
        await transporter.sendMail(mailOptions);
    } catch (emailError) {
        console.error(`Email failed (to: ${mailOptions.to}):`, emailError);
    }
}
module.exports = {
    updateTicketStatus,
    createTimelineLog,
    completePendingLog,
    sendEmailSafe
};