"use strict";
const nodemailer = require("nodemailer");

// One transporter for the whole app. Nodemailer doesn't connect until
// sendMail() is called, so this is safe even when SMTP_* isn't configured.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: true,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendEmailSafe(transporter, mailOptions) {
    try {
        await transporter.sendMail(mailOptions);
    } catch (emailError) {
        console.error(`Email failed (to: ${mailOptions.to}):`, emailError);
    }
}

module.exports = {
    transporter,
    sendEmailSafe
};
