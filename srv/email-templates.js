"use strict";

const {
    buildTheme, renderShell, renderButton, renderRows, renderTable, escapeHtml
} = require("./email-theme");

const APP_URL = process.env.APP_URL || "";

function ticketLink(ticket) {
    return APP_URL && ticket?.ticketID ? `${APP_URL}/index.html#/detail/${encodeURIComponent(ticket.ticketID)}` : "";
}

function fileSize(bytes) {
    if (!bytes && bytes !== 0) { return ""; }
    return bytes < 1024 ? `${bytes} B`
        : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
        : `${(bytes / 1048576).toFixed(1)} MB`;
}

// Uploaded documents block. Renders nothing when the caller passes no list,
// so a template stays valid whether or not attachments were fetched.
function documentsBlock(theme, attachments) {
    if (!attachments || !attachments.length) { return ""; }
    return `<div style="font-weight:bold;margin:18px 0 4px;">Uploaded Documents</div>`
        + renderTable(theme, ["File", "Type", "Size"],
            attachments.map(a => [a.fileName || "", a.mediaType || "", fileSize(a.fileSize)]));
}

function ticketRows(ticket) {
    return [
        { label: "Ticket Number", value: ticket.ticketNumber },
        { label: "Ticket Type", value: ticket.ticketType },
        { label: "Priority", value: ticket.priority },
        { label: "Status", value: ticket.status },
        { label: "Description", value: ticket.description }
    ];
}

// ---------------- EndUser Confirmation ----------------
function buildConfirmationEmailTemplate(ticket, theme, attachments) {
    const t = theme || buildTheme(null);
    return renderShell(t, {
        title: "Your Ticket Has Been Submitted",
        body: `
            <p style="margin:0 0 12px;">Hi ${escapeHtml(ticket.createdByName || "there")},</p>
            <p style="margin:0 0 16px;">Your ticket has been submitted successfully. Our team will review it shortly.</p>
            ${renderRows(ticketRows(ticket))}
            ${documentsBlock(t, attachments)}
            ${renderButton(t, "View Your Ticket", ticketLink(ticket))}
            <p style="margin:0;">You'll be notified once your ticket is assigned and progresses further.</p>`
    });
}

// ---------------- Service Group Notification ----------------
function buildServiceGroupEmailTemplate(ticket, theme, attachments) {
    const t = theme || buildTheme(null);
    return renderShell(t, {
        title: "New Ticket Submitted",
        body: `
            <p style="margin:0 0 16px;">A new ticket needs review and assignment to a Consultant.</p>
            ${renderRows([
                ...ticketRows(ticket),
                { label: "Submitted By", value: ticket.createdByName },
                { label: "Location", value: ticket.createdByLocation },
                { label: "Organization", value: ticket.orgName }
            ])}
            ${documentsBlock(t, attachments)}
            ${renderButton(t, "Review Ticket", ticketLink(ticket))}`
    });
}

// Builds the HTML only — sending happens in service.js, where the nodemailer
// transporter lives.
function buildAssignmentEmailTemplate(ticket, consultantName, theme, attachments) {
    const t = theme || buildTheme(null);
    return renderShell(t, {
        title: "Ticket Assigned To You",
        body: `
            <p style="margin:0 0 12px;">Hello ${escapeHtml(consultantName || "there")},</p>
            <p style="margin:0 0 16px;">Ticket <strong>${escapeHtml(ticket.ticketNumber || "")}</strong> has been assigned to you.</p>
            ${renderRows(ticketRows(ticket))}
            ${documentsBlock(t, attachments)}
            ${renderButton(t, "Open Ticket", ticketLink(ticket))}
            <p style="margin:0;">Please log in to the ITSM application to process this ticket.</p>`
    });
}

// ---------------- Password Setup / Reset ----------------
function buildPasswordSetupEmailTemplate(user, link, isReset, validHours, theme) {
    const t = theme || buildTheme(null);
    return renderShell(t, {
        title: isReset ? "Reset Your Password" : "Welcome to ITSM",
        body: `
            <p style="margin:0 0 12px;">Hi ${escapeHtml(user.name || "there")},</p>
            <p style="margin:0 0 16px;">${isReset
                ? "We received a request to reset your ITSM password."
                : "An account has been created for you on the ITSM Service Desk."}
               Use the button below to ${isReset ? "choose a new password" : "set your password"}.</p>
            ${renderButton(t, isReset ? "Reset Password" : "Set Password", link)}
            <p style="margin:0 0 12px;">This link is valid for ${escapeHtml(validHours)} hours and can be used only once.</p>
            <p style="margin:0;color:#6d7a95;">If you didn't expect this email, you can safely ignore it.</p>`,
        footerNote: "If the button doesn't work, copy this link into your browser: " + (link || "")
    });
}

// ---------------- Reminder / daily digest ----------------
function buildEmail(title, message, tickets, theme) {
    const t = theme || buildTheme(null);
    const rows = (tickets || []).map(x => [
        x.ticketNumber || x.ticketID || "",
        x.shortDescription || "",
        x.priority || "",
        x.status || ""
    ]);
    const single = tickets && tickets.length === 1 ? tickets[0] : null;
    return renderShell(t, {
        title,
        body: `
            <p style="margin:0 0 16px;">${escapeHtml(message)}</p>
            ${renderTable(t, ["Ticket", "Description", "Priority", "Status"], rows)}
            ${single ? renderButton(t, "Open Ticket", ticketLink(single)) : ""}
            <p style="margin:0;">Please log in to the ITSM application to action these tickets.</p>`
    });
}

module.exports = {
    buildConfirmationEmailTemplate,
    buildServiceGroupEmailTemplate,
    buildAssignmentEmailTemplate,
    buildPasswordSetupEmailTemplate,
    buildEmail
};
