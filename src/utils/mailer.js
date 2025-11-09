let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  // lazily require nodemailer so the module load doesn't crash the app when
  // the dependency hasn't been installed in a dev environment.
  let nodemailer;
  try {
    nodemailer = require("nodemailer");
  } catch (e) {
    console.warn(
      "nodemailer not available. Install it with `npm install nodemailer` to enable email sending."
    );
    return null;
  }

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465", 10);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn("SMTP not configured: missing env vars");
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporter;
}

async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) throw new Error("SMTP not configured or nodemailer missing");
  const info = await t.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
  return info;
}

module.exports = { sendMail, getTransporter };
