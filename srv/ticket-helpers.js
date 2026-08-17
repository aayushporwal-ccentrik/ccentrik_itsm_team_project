"use strict";
async function sendEmailSafe(transporter, mailOptions) {
    try {
        await transporter.sendMail(mailOptions);
    } catch (emailError) {
        console.error(`Email failed (to: ${mailOptions.to}):`, emailError);
    }
}

module.exports = {
    sendEmailSafe
};
