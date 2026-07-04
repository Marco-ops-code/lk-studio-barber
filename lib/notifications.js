const fs = require('fs');
const { seedDataFile } = require('./paths');

const LOG_FILE = seedDataFile('notifications.json');

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeLog(entries) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries.slice(-200), null, 2), 'utf8');
}

function appendLog(entry) {
  const log = readLog();
  log.push({ ...entry, id: Date.now().toString(36), at: new Date().toISOString() });
  writeLog(log);
  return entry;
}

function formatBookingMessage(type, booking, settings) {
  const salon = 'LK Studio BarberShop';
  const date = new Date(booking.date + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  if (type === 'confirmation') {
    return {
      subject: `Confirmation — ${salon}`,
      body: `Bonjour${booking.name ? ' ' + booking.name : ''},\n\nVotre rendez-vous est confirmé :\n📅 ${date} à ${booking.time}${booking.serviceName ? '\n✂️ ' + booking.serviceName : ''}\n\n${settings.salonAddress || ''}\n${settings.salonPhone || ''}\n\nÀ bientôt !\n— ${salon}`,
      sms: `LK Studio: RDV confirmé le ${booking.date} à ${booking.time}.`,
    };
  }

  if (type === 'reminder') {
    return {
      subject: `Rappel demain — ${salon}`,
      body: `Bonjour${booking.name ? ' ' + booking.name : ''},\n\nRappel : votre rendez-vous est demain ${date} à ${booking.time}.\n\nÀ demain !\n— ${salon}`,
      sms: `LK Studio: rappel RDV demain ${booking.date} à ${booking.time}.`,
    };
  }

  if (type === 'cancellation') {
    return {
      subject: `Annulation — ${salon}`,
      body: `Bonjour,\n\nVotre rendez-vous du ${date} à ${booking.time} a été annulé.\n\n— ${salon}`,
      sms: `LK Studio: RDV du ${booking.date} ${booking.time} annulé.`,
    };
  }

  return { subject: salon, body: '', sms: '' };
}

async function sendEmail(to, subject, body) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;

  if (!host || !user) {
    appendLog({ channel: 'email', to, subject, body, status: 'simulated' });
    return { ok: true, simulated: true };
  }

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to,
      subject,
      text: body,
    });
    appendLog({ channel: 'email', to, subject, status: 'sent' });
    return { ok: true, simulated: false };
  } catch (err) {
    appendLog({ channel: 'email', to, subject, status: 'error', error: err.message });
    return { ok: false, error: err.message };
  }
}

async function sendSms(phone, message) {
  if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM) {
    try {
      const auth = Buffer.from(`${process.env.TWILIO_SID}:${process.env.TWILIO_TOKEN}`).toString('base64');
      const params = new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM, Body: message });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (!res.ok) throw new Error(await res.text());
      appendLog({ channel: 'sms', to: phone, body: message, status: 'sent' });
      return { ok: true };
    } catch (err) {
      appendLog({ channel: 'sms', to: phone, status: 'error', error: err.message });
    }
  }

  appendLog({ channel: 'sms', to: phone, body: message, status: 'simulated' });
  return { ok: true, simulated: true };
}

async function notifyBooking(type, booking, settings) {
  const email = booking.email || null;
  const msg = formatBookingMessage(type, booking, settings);
  const results = {};

  if (email) {
    results.email = await sendEmail(email, msg.subject, msg.body);
  } else {
    appendLog({ channel: 'email', to: booking.phone, subject: msg.subject, body: msg.body, status: 'simulated', note: 'Pas d\'email — contenu enregistré' });
    results.email = { ok: true, simulated: true, logged: true };
  }

  if (booking.phone) {
    results.sms = await sendSms(booking.phone, msg.sms);
  }

  return results;
}

function getTomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function runReminderCheck(readStore, writeStore) {
  const store = readStore();
  const tomorrow = getTomorrowISO();
  let changed = false;

  for (const b of store.bookings) {
    if (b.status !== 'confirmed' || b.date !== tomorrow || b.remindedAt) continue;
    notifyBooking('reminder', b, store.settings);
    b.remindedAt = new Date().toISOString();
    changed = true;
  }

  if (changed) writeStore(store);
}

function startReminderScheduler(readStore, writeStore) {
  runReminderCheck(readStore, writeStore);
  setInterval(() => runReminderCheck(readStore, writeStore), 60 * 60 * 1000);
}

module.exports = {
  appendLog,
  readLog,
  notifyBooking,
  startReminderScheduler,
};
