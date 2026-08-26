"use strict";
const nodemailer = require("nodemailer");
const { toPlainText } = require("./email-theme");

const PORT = Number(process.env.SMTP_PORT) || 587;

// One transporter for the whole app. Nodemailer doesn't connect until
// sendMail() is called, so this is safe even when SMTP_* isn't configured.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: PORT,
    secure: PORT === 465,   // 465 is implicit TLS; 587 upgrades via STARTTLS
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Drop obviously-unroutable addresses. One bad recipient can get the whole
// message rejected by the receiving MTA, taking the good addresses with it.
function validRecipients(to) {
    const list = Array.isArray(to) ? to : [to];
    return list.filter(a => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(a || ""));
}

async function sendEmailSafe(transporter, mailOptions) {
    const to = validRecipients(mailOptions.to);
    const dropped = (Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to])
        .filter(a => !to.includes(a));

    if (dropped.length) {
        console.warn(`[mail] skipping invalid recipient(s): ${dropped.join(", ")}`);
    }
    if (!to.length) {
        console.warn(`[mail] no valid recipient for "${mailOptions.subject}" — not sent`);
        return false;
    }
    if (!process.env.SMTP_HOST) {
        console.warn(`[mail] SMTP_HOST not set — "${mailOptions.subject}" logged, not sent (to: ${to.join(", ")})`);
        return false;
    }

    try {
        const info = await transporter.sendMail({
            ...mailOptions,
            to,
            // Without a From the SMTP server rejects the message outright.
            from: mailOptions.from || process.env.MAIL_FROM || process.env.SMTP_USER,
            // multipart/alternative — an HTML-only mail scores badly with spam filters.
            text: mailOptions.text || (mailOptions.html ? toPlainText(mailOptions.html) : undefined)
        });
        console.log(`[mail] sent "${mailOptions.subject}" -> ${info.accepted.join(", ")}`
            + (info.rejected.length ? ` | REJECTED: ${info.rejected.join(", ")}` : ""));
        return true;
    } catch (emailError) {
        console.error(`[mail] FAILED "${mailOptions.subject}" (to: ${to.join(", ")}): ${emailError.message}`);
        return false;
    }
}

module.exports = {
    transporter,
    sendEmailSafe
};
