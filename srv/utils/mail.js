const cds = require("@sap/cds");
const nodemailer = require("nodemailer");

const LOG = cds.log("mail");

// Gmail SMTP over implicit TLS. The account and its App Password come from
// the environment (see .env / .gitignore) — never from the caller and never
// from source, so the same code runs locally and in Cloud Foundry.
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 465;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Shown as the sender name in the recipient's inbox. The address itself is
// always SMTP_USER — Gmail rejects a From it doesn't own.
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "ITSM Notification";

// Built once and reused: each transporter keeps its own SMTP connection
// pool, so creating one per mail would re-authenticate every time.
let oTransporter;

function getTransporter() {
  if (oTransporter) { return oTransporter; }

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error("Mail is not configured: SMTP_USER and SMTP_PASS must be set in the environment.");
  }

  oTransporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  return oTransporter;
}

// Callers pass whatever body they have. Anything with a tag is sent as HTML
// (with a plain-text fallback for clients that refuse HTML); anything else
// is sent as plain text. Keeps the signature free of a "isHtml" flag.
function buildContent(sBody) {
  if (!/<[a-z][\s\S]*>/i.test(sBody)) { return { text: sBody }; }

  // <head>, <style> and <script> have to go as whole blocks first: stripping
  // tags alone would leave their *contents* (CSS rules, conditional-comment
  // markup) sitting in the plain-text part as gibberish. Matters as soon as
  // the body is a full HTML document rather than a snippet.
  const sText = sBody
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&mdash;/gi, "-")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html: sBody, text: sText };
}

/**
 * Sends one email through the configured Gmail account.
 *
 * Deliberately knows nothing about tickets, users or teams — the caller
 * decides the recipient and composes the content.
 *
 * @param {object}       options
 * @param {string}       options.subject     Required.
 * @param {string}       options.body        Required. HTML or plain text.
 * @param {string|string[]} options.to       Required. One or more recipients.
 * @param {string|string[]} [options.cc]     Optional.
 * @param {object|object[]} [options.attachment] Optional. Nodemailer attachment format.
 * @returns {Promise<{messageId: string, accepted: string[], rejected: string[]}>}
 */
async function sendMail({ subject, body, to, cc, attachment } = {}) {
  if (!subject) { throw new Error("sendMail: 'subject' is required."); }
  if (!body) { throw new Error("sendMail: 'body' is required."); }
  if (!to || (Array.isArray(to) && !to.length)) { throw new Error("sendMail: 'to' is required."); }

  const oMail = {
    from: { name: SMTP_FROM_NAME, address: SMTP_USER },
    to,
    subject,
    ...buildContent(body)
  };
  if (cc) { oMail.cc = cc; }
  if (attachment) { oMail.attachments = Array.isArray(attachment) ? attachment : [attachment]; }

  try {
    const oInfo = await getTransporter().sendMail(oMail);
    LOG.info("Mail sent:", { subject, to, messageId: oInfo.messageId });
    return { messageId: oInfo.messageId, accepted: oInfo.accepted, rejected: oInfo.rejected };
  } catch (oError) {
    // oError carries the real SMTP reason (auth failure, host unreachable,
    // bad recipient) but never the password — nodemailer keeps it out of
    // both message and code, so this is safe to log and to re-throw.
    LOG.error("Mail failed:", { subject, to, code: oError.code, reason: oError.message });
    throw new Error("Failed to send email: " + oError.message);
  }
}

module.exports = { sendMail };
