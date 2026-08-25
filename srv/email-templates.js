
"use strict";

// ---------------- Email Template: EndUser Confirmation ----------------
function buildConfirmationEmailTemplate(ticket) {
    return `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
            <h2 style="color:#1F4E78;">Your Ticket Has Been Submitted</h2>
            <p>Hi ${ticket.createdByName || "there"},</p>
            <p>Your ticket has been successfully submitted. Our team will review it shortly.</p>
            <table style="border-collapse: collapse; width: 100%;">
                <tr><td style="padding:6px; font-weight:bold;">Ticket Number</td><td style="padding:6px;">${ticket.ticketNumber}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Ticket Type</td><td style="padding:6px;">${ticket.ticketType}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Description</td><td style="padding:6px;">${ticket.description}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Status</td><td style="padding:6px;">${ticket.status}</td></tr>
            </table>
            <p style="margin-top:16px;">You'll be notified once your ticket is assigned and progresses further.</p>
        </div>
    `;
}

// ---------------- Email Template: Service Group Notification ----------------
function buildServiceGroupEmailTemplate(ticket) {
    return `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
            <h2 style="color:#1F4E78;">New Ticket Submitted</h2>
            <table style="border-collapse: collapse; width: 100%;">
                <tr><td style="padding:6px; font-weight:bold;">Ticket Number</td><td style="padding:6px;">${ticket.ticketNumber}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Ticket Type</td><td style="padding:6px;">${ticket.ticketType}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Description</td><td style="padding:6px;">${ticket.description}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Status</td><td style="padding:6px;">${ticket.status}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Submitted By</td><td style="padding:6px;">${ticket.createdByName}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Location</td><td style="padding:6px;">${ticket.createdByLocation}</td></tr>
                <tr><td style="padding:6px; font-weight:bold;">Organization</td><td style="padding:6px;">${ticket.orgName}</td></tr>
            </table>
            <p style="margin-top:16px;">Please review and assign this ticket to a Consultant.</p>
        </div>
    `;
}

// ---------------- Email Template: Assignment Notification ----------------
// NOTE: This function ONLY builds and returns the HTML string.
// It does NOT send the email itself — sending happens in service.js,
// where the 'transporter' (nodemailer) instance actually lives.
// This fixes the earlier bug: "ReferenceError: transporter is not defined".
function buildAssignmentEmailTemplate(ticket, consultantName) {
    return `
        <html>
        <body>
            <p>Hello ${consultantName || "there"},</p>
            <p>
                Ticket <strong>${ticket.ticketNumber}</strong>
                has been assigned to you.
            </p>
            <p>
                Please log in to the ITSM application
                to view and process the ticket.
            </p>
            <br>
            <p>
                Regards,<br>
                ITSM System
            </p>
        </body>
        </html>
    `;
}

// ---------------- Email Template: Password Setup / Reset ----------------
function buildPasswordSetupEmailTemplate(user, link, isReset, validHours) {
    return `
        <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333;">
            <h2 style="color:#1F4E78;">${isReset ? "Reset Your Password" : "Welcome to ITSM"}</h2>
            <p>Hi ${user.name || "there"},</p>
            <p>${isReset
                ? "We received a request to reset your ITSM password."
                : "An account has been created for you on the ITSM Service Desk."}
               Click the button below to ${isReset ? "choose a new password" : "set your password"}.</p>
            <p style="margin:24px 0;">
                <a href="${link}" style="background:#021a86; color:#ffffff; padding:10px 20px; border-radius:4px; text-decoration:none;">
                    ${isReset ? "Reset Password" : "Set Password"}
                </a>
            </p>
            <p>This link is valid for ${validHours} hours and can be used only once.</p>
            <p style="color:#777;">If you didn't expect this email, you can safely ignore it.</p>
        </div>
    `;
}

module.exports = {
    buildConfirmationEmailTemplate,
    buildServiceGroupEmailTemplate,
    buildAssignmentEmailTemplate,
    buildPasswordSetupEmailTemplate,
    buildEmail
};

 
function buildEmail(title, message, tickets) {
    return `
<div style="font-family: Arial; font-size: 14px; color: #333;">
<h2>${title}</h2>
<p>${message}</p>
 
            <table style="border-collapse: collapse; width: 100%;">
<tr>
<th>Ticket</th>
<th>Description</th>
<th>Priority</th>
<th>Status</th>
</tr>
 
                ${tickets.map(ticket => `
<tr>
<td>${ticket.ticketNumber || ticket.ticketID}</td>
<td>${ticket.shortDescription || ""}</td>
<td>${ticket.priority || ""}</td>
<td>${ticket.status || ""}</td>
</tr>
                `).join("")}
</table>
 
            <p>Please log in to the ITSM application to action these tickets.</p>
</div>
    `;
}
 
