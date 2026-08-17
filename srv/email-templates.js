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

module.exports = {
    buildConfirmationEmailTemplate,
    buildServiceGroupEmailTemplate,
    buildAssignmentEmailTemplate
};