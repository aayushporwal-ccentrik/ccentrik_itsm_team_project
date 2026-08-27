"use strict";

const cds = require("@sap/cds");

// ITSM's own navy — what every recipient sees when no org theme applies.
const DEFAULT_THEME = {
    type: "SOLID",
    primaryColor: "#021a86",
    secondaryColor: "#021a86",
    buttonColor: "#021a86",
    buttonTextColor: "#ffffff",
    logo: null,
    orgName: null
};

// Admin-typed free text from an Input, never a trusted source.
// Same rule the frontend uses in formatter.js / Component.js.
function isHexColor(s) {
    return /^#[0-9a-fA-F]{3,8}$/.test(s || "");
}

function safeColor(s, fallback) {
    return isHexColor(s) ? s : fallback;
}

function escapeHtml(s) {
    if (s === null || s === undefined) { return ""; }
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Only http(s) logos. A data: URI would push the mail past Gmail's 102KB
// clipping limit, and javascript: would be an injection vector.
function safeUrl(s) {
    return /^https?:\/\/[^\s"'<>]+$/i.test(s || "") ? s : null;
}

// Build the render-ready theme from an Organization row.
// Every colour is validated; anything invalid silently falls back to navy,
// so a bad admin value can never break an email.
function buildTheme(org) {
    if (!org) { return { ...DEFAULT_THEME, ...derive(DEFAULT_THEME) }; }

    const primary = safeColor(org.primaryColor, DEFAULT_THEME.primaryColor);
    const secondary = safeColor(org.secondaryColor, primary);
    const isGradient = org.themeType === "GRADIENT" && isHexColor(org.secondaryColor);

    const base = {
        type: isGradient ? "GRADIENT" : "SOLID",
        primaryColor: primary,
        secondaryColor: secondary,
        // Buttons are always flat, never the gradient — same rule as the UI.
        buttonColor: safeColor(org.formBtnColor, primary),
        buttonTextColor: safeColor(org.formBtnTextColor, "#ffffff"),
        logo: safeUrl(org.logo),
        orgName: org.name || null
    };

    return { ...base, ...derive(base) };
}

function derive(t) {
    return {
        // CSS value for clients that support gradients.
        headerBackground: t.type === "GRADIENT"
            ? `linear-gradient(to bottom, ${t.primaryColor}, ${t.secondaryColor})`
            : t.primaryColor,
        // Solid hex for the bgcolor attribute — the universal fallback that
        // Outlook desktop and older clients actually paint.
        headerFallback: t.primaryColor,
        buttonBackground: t.buttonColor,
        footerBackground: "#f4f6fa",
        footerAccent: t.primaryColor,
        textColor: "#ffffff",
        bodyTextColor: "#333333"
    };
}

// Resolve an org theme from a userId. Returns the default theme when the
// user has no client, the org is inactive, or anything goes wrong.
async function themeForUser(userId, tx) {
    if (!userId) { return buildTheme(null); }
    try {
        const db = tx || cds.db;
        const { User, Organization } = cds.entities("itsm.master");
        const user = await db.run(SELECT.one.from(User).where({ userId }));
        if (!user || !user.client) { return buildTheme(null); }

        const org = await db.run(
            SELECT.one.from(Organization).where({ code: user.client, isActive: true })
        );
        return buildTheme(org);
    } catch (e) {
        console.error(`[email-theme] theme lookup failed for ${userId}:`, e.message);
        return buildTheme(null);
    }
}

// A ticket's branding follows the person who raised it, not whoever is acting.
// The consultant receiving an assignment mail has no org of their own, but the
// mail is still about the requester's organisation.
async function themeForTicket(ticket, tx) {
    return themeForUser(ticket?.reportedBy, tx);
}


// ---------------------------------------------------------------
// HTML shell. Table-based, inline styles only, no JavaScript.
// ---------------------------------------------------------------

const WIDTH = 600;

// Outlook desktop renders with Word, which ignores background-image, so a CSS
// gradient never reaches it. bgcolor gives it the org's primary colour, and a
// VML rect paints the real gradient on the Outlook versions that support it.
function headerCell(theme, innerHtml, height) {
    const gradient = theme.type === "GRADIENT";
    const vmlOpen = gradient ? `
      <!--[if gte mso 9]>
      <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false"
              style="width:${WIDTH}px;height:${height}px;">
        <v:fill type="gradient" color="${theme.primaryColor}" color2="${theme.secondaryColor}" angle="180" />
        <v:textbox inset="0,0,0,0"><![endif]-->` : "";
    const vmlClose = gradient ? `
      <!--[if gte mso 9]></v:textbox></v:rect><![endif]-->` : "";

    return `<td align="center" bgcolor="${theme.headerFallback}"
                style="background:${theme.headerFallback};background:${theme.headerBackground};padding:0;">${vmlOpen}
              <div style="padding:24px;">${innerHtml}</div>${vmlClose}
            </td>`;
}

// Bulletproof button: VML for Outlook, plain anchor everywhere else.
// Always a flat colour — a button must never carry the gradient.
function renderButton(theme, label, href) {
    const url = safeUrl(href);
    if (!url) { return ""; }
    const text = escapeHtml(label);
    return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
      <tr><td align="center" style="padding:8px 0 24px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                     href="${url}" arcsize="8%" strokecolor="${theme.buttonBackground}"
                     fillcolor="${theme.buttonBackground}"
                     style="height:42px;v-text-anchor:middle;width:220px;">
          <w:anchorlock/>
          <center style="color:${theme.buttonTextColor};font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">${text}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${url}"
           style="background-color:${theme.buttonBackground};color:${theme.buttonTextColor};
                  display:inline-block;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;
                  line-height:42px;text-align:center;text-decoration:none;width:220px;
                  border-radius:4px;-webkit-text-size-adjust:none;">${text}</a>
        <!--<![endif]-->
      </td></tr>
    </table>`;
}

// Label/value rows for ticket detail blocks.
function renderRows(rows) {
    const cells = (rows || [])
        .filter(r => r && r.value !== undefined && r.value !== null && r.value !== "")
        .map(r => `
          <tr>
            <td style="padding:8px 12px;font-family:Arial,sans-serif;font-size:13px;color:#6d7a95;
                       border-bottom:1px solid #e8edf4;width:38%;">${escapeHtml(r.label)}</td>
            <td style="padding:8px 12px;font-family:Arial,sans-serif;font-size:13px;color:#151b2b;
                       border-bottom:1px solid #e8edf4;">${escapeHtml(r.value)}</td>
          </tr>`).join("");
    if (!cells) { return ""; }
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                   style="border-collapse:collapse;margin:8px 0 16px;">${cells}</table>`;
}

// Multi-column table — ticket lists and the uploaded-documents block.
function renderTable(theme, headers, rows) {
    if (!rows || !rows.length) { return ""; }
    const head = headers.map(h => `
        <th align="left" style="padding:8px 10px;font-family:Arial,sans-serif;font-size:12px;
                   color:#ffffff;background-color:${theme.footerAccent};font-weight:bold;">${escapeHtml(h)}</th>`).join("");
    const body = rows.map(cs => `
        <tr>${cs.map(c => `
          <td style="padding:8px 10px;font-family:Arial,sans-serif;font-size:13px;color:#151b2b;
                     border-bottom:1px solid #e8edf4;">${escapeHtml(c)}</td>`).join("")}
        </tr>`).join("");
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="border-collapse:collapse;margin:8px 0 16px;">
        <tr>${head}</tr>${body}
      </table>`;
}

// The one shell every template renders into.
function renderShell(theme, opts) {
    const t = theme || buildTheme(null);
    const title = escapeHtml(opts.title || "");
    const logo = t.logo
        ? `<img src="${t.logo}" alt="${escapeHtml(t.orgName || "")}" width="140"
                style="display:block;border:0;max-width:140px;height:auto;margin:0 auto 10px;">`
        : "";
    const heading = `${logo}<div style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;
                     color:${t.textColor};line-height:1.3;">${title}</div>`;

    return `<!DOCTYPE html>
<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<title>${title}</title>
<style>
  @media only screen and (max-width:620px){
    .wrap{width:100% !important;}
    .pad{padding-left:16px !important;padding-right:16px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6fa;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" class="wrap" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"
           style="width:${WIDTH}px;max-width:${WIDTH}px;background-color:#ffffff;border-collapse:collapse;">
      <tr>${headerCell(t, heading, t.logo ? 130 : 88)}</tr>
      <tr><td class="pad" style="padding:24px;font-family:Arial,sans-serif;font-size:14px;
                                 line-height:1.6;color:${t.bodyTextColor};">
        ${opts.body || ""}
      </td></tr>
      <tr><td bgcolor="${t.footerBackground}"
              style="background-color:${t.footerBackground};border-top:3px solid ${t.footerAccent};
                     padding:16px 24px;font-family:Arial,sans-serif;font-size:12px;color:#6d7a95;">
        ${escapeHtml(opts.footerNote || "This is an automated message from the ITSM Service Desk. Please do not reply.")}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Plain-text alternative. Without one the message is HTML-only, which costs
// real spam score and breaks text-only clients.
function toPlainText(html) {
    return String(html)
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<\/(tr|div|p|h\d|table)>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .trim();
}

module.exports = {
    DEFAULT_THEME,
    isHexColor,
    escapeHtml,
    safeUrl,
    buildTheme,
    themeForUser,
    themeForTicket,
    renderShell,
    renderButton,
    renderRows,
    renderTable,
    toPlainText
};
