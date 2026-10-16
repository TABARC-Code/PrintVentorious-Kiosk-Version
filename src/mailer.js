/*
 * The smallest mailer that does the job: plain text, one recipient, no attachments.
 * Off unless you give it a connection URL. Credentials come from the environment and live nowhere else:
 * not the database, not the page, not a log.
 *
 *   KIOSK_SMTP_URL   smtps://user:password@smtp.example.com:465   (or smtp://... for port 587 with STARTTLS)
 *   KIOSK_MAIL_FROM  "Your Print Shop" <quotes@example.com>
 *   KIOSK_MAIL_REPLY_TO  optional
 *
 * Testing: pass { transport: { jsonTransport: true } } and nothing leaves the machine.
 */
'use strict';

// One plain address, nothing clever: no names, groups, lists or line breaks. The page checks this too, but a mailer
// that trusts its caller is how a form becomes a spam relay. (Stripping newlines alone isn't enough: nodemailer
// then reads "a@b.co Bcc: c@d.co" as a group and mails both.)
const ONE_ADDRESS = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function parseAdminRecipients(value) {
  if (!value) return [];
  const addresses = String(value).split(',').map((entry) => entry.trim());
  if (addresses.some((address) => !ONE_ADDRESS.test(address))) throw new Error('KIOSK_ADMIN_EMAILS must contain plain email addresses separated by commas.');
  const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
  if (unique.length > 10) throw new Error('KIOSK_ADMIN_EMAILS supports at most 10 addresses.');
  return unique;
}

function createMailer({ url, from, replyTo, transport } = {}) {
  if (!from || (!url && !transport)) return null;
  let connection;
  if (!transport) {
    connection = new URL(url);
    if (!['smtp:', 'smtps:'].includes(connection.protocol)) throw new Error('Use an smtp:// or smtps:// mail server address.');
    for (const [key, value] of Object.entries({ requireTLS: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 })) {
      connection.searchParams.set(key, String(value));
    }
  }
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport(transport || connection.toString());
  return {
    async send({ to, subject, text, replyTo: messageReplyTo }) {
      if (!ONE_ADDRESS.test(String(to))) return { ok: false, error: 'Not a single plain email address.' };
      if (messageReplyTo !== undefined && !ONE_ADDRESS.test(String(messageReplyTo))) return { ok: false, error: 'Not a single plain reply address.' };
      try {
        // nodemailer rejects header injection itself, but strip line breaks anyway. Cheap and boring.
        const clean = (v) => String(v).replace(/[\r\n]+/g, ' ');
        const info = await t.sendMail({ from, to: String(to), subject: clean(subject), text, ...((messageReplyTo || replyTo) ? { replyTo: messageReplyTo || replyTo } : {}) });
        return { ok: true, info };
      } catch (e) { return { ok: false, error: e.message }; }
    }
  };
}

function mailerFromEnv(env = process.env) {
  return createMailer({ url: env.KIOSK_SMTP_URL, from: env.KIOSK_MAIL_FROM, replyTo: env.KIOSK_MAIL_REPLY_TO });
}

module.exports = { createMailer, mailerFromEnv, parseAdminRecipients };

