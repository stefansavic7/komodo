import nodemailer from 'nodemailer';

// Bez SMTP_URL u api/.env email se ne šalje, nego se ispiše u terminalu (za razvoj).
const transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
export const mailOn = transport !== null;

export async function sendMail(log, { to, subject, text }) {
  if (!transport) {
    log.info(`[email nije podešen] Za: ${to} | ${subject}\n${text}`);
    return;
  }
  try {
    await transport.sendMail({ from: process.env.MAIL_FROM || 'Komodo <no-reply@komodo.ba>', to, subject, text });
  } catch (err) {
    log.error(err, `Email za ${to} nije poslan`);
  }
}
