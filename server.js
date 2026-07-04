require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const payments = require('./lib/payments');
const notifications = require('./lib/notifications');
const schedule = require('./lib/schedule');
const { seedDataFile } = require('./lib/paths');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DATA_FILE = seedDataFile('store.json');

const app = express();
app.use(cors());

const adminTokens = new Set();

function readStore() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);
  if (!data.blockedSlots) data.blockedSlots = [];
  if (!data.clientNotes) data.clientNotes = {};
  if (!data.settings.services) data.settings.services = [];
  if (data.settings.workDays === undefined) {
    data.settings.workDays = data.settings.patternInterval === 1 ? 7 : 2;
    data.settings.offDays = data.settings.patternInterval === 1 ? 0 : 2;
  }
  return data;
}

function writeStore(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function purgeExpiredPending(store) {
  const now = Date.now();
  const before = store.bookings.length;
  store.bookings = store.bookings.filter((b) => {
    if (b.status !== 'pending' || !b.pendingUntil) return true;
    return new Date(b.pendingUntil).getTime() >= now;
  });
  if (store.bookings.length !== before) writeStore(store);
  return store;
}

function isDayBlocked(store, date) {
  return store.blockedSlots.some((b) => b.date === date && !b.time);
}

function isSlotBlocked(store, date, time) {
  if (isDayBlocked(store, date)) return true;
  return store.blockedSlots.some((b) => b.date === date && b.time === time);
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

function confirmBookingById(bookingId, paymentMeta = {}) {
  const store = readStore();
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) return null;
  if (booking.status === 'confirmed') return booking;

  booking.status = 'confirmed';
  delete booking.pendingUntil;
  booking.confirmedAt = new Date().toISOString();
  Object.assign(booking, paymentMeta);
  if (!booking.paymentMethod) booking.paymentMethod = paymentMeta.paymentMethod || 'simulated';

  writeStore(store);

  if (store.settings.notificationsEnabled !== false) {
    notifications.notifyBooking('confirmation', booking, store.settings);
  }

  return booking;
}

/* Stripe webhook — raw body */
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const result = await payments.handleWebhook(
    req.body,
    req.headers['stripe-signature'],
    (id, meta) => Promise.resolve(confirmBookingById(id, meta))
  );
  if (!result.ok) return res.status(400).json(result);
  res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    stripe: payments.isStripeEnabled(),
    notifications: Boolean(process.env.SMTP_HOST) ? 'smtp' : 'simulated',
  });
});

app.get('/api/settings', (_req, res) => {
  const store = readStore();
  res.json({
    ...store.settings,
    stripeEnabled: payments.isStripeEnabled(),
    stripePublishableKey: payments.getPublishableKey(),
    scheduleLabel: schedule.cycleLabel(store.settings),
  });
});

app.get('/api/blocked-slots', (_req, res) => {
  res.json(readStore().blockedSlots);
});

app.get('/api/bookings', (_req, res) => {
  res.json(purgeExpiredPending(readStore()).bookings);
});

app.get('/api/stats', requireAdmin, (_req, res) => {
  const store = purgeExpiredPending(readStore());
  const today = new Date().toISOString().slice(0, 10);
  const bookings = store.bookings;
  res.json({
    today: bookings.filter((b) => b.date === today && b.status === 'confirmed').length,
    pending: bookings.filter((b) => b.status === 'pending').length,
    confirmed: bookings.filter((b) => b.status === 'confirmed').length,
    total: bookings.length,
    upcoming: bookings
      .filter((b) => b.status === 'confirmed' && b.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
      .slice(0, 10),
  });
});

app.get('/api/stats/advanced', requireAdmin, (_req, res) => {
  const store = purgeExpiredPending(readStore());
  const bookings = store.bookings;
  const deposit = store.settings.depositAmount || 15;
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const confirmed = bookings.filter((b) => b.status === 'confirmed');
  const confirmedMonth = confirmed.filter((b) => b.date >= monthStart);
  const cancelled = bookings.filter((b) => b.status === 'cancelled');

  const weekDays = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const byWeekday = weekDays.map((label, i) => ({
    label,
    count: confirmed.filter((b) => new Date(b.date + 'T12:00:00').getDay() === i).length,
  }));

  const hourMap = {};
  confirmed.forEach((b) => {
    const h = b.time.slice(0, 2);
    hourMap[h] = (hourMap[h] || 0) + 1;
  });
  const hourDistribution = Object.entries(hourMap)
    .map(([hour, count]) => ({ hour: hour + ':00', count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));
  const peak = hourDistribution.reduce((best, cur) => (cur.count > (best?.count || 0) ? cur : best), null);

  const phonesSeen = new Set();
  let newClientsMonth = 0;
  confirmedMonth.forEach((b) => {
    const prior = confirmed.some((x) => x.phone === b.phone && x.date < monthStart);
    if (!prior && !phonesSeen.has(b.phone)) {
      phonesSeen.add(b.phone);
      newClientsMonth++;
    }
  });

  const stripeRevenue = confirmedMonth
    .filter((b) => b.paymentMethod === 'stripe')
    .reduce((sum, b) => sum + (b.paidAmount || deposit), 0);

  res.json({
    revenueMonth: confirmedMonth.length * deposit,
    stripeRevenue,
    cancelled: cancelled.length,
    weekDays: byWeekday,
    hourPeak: peak?.hour || '—',
    hourDistribution,
    newClientsMonth,
    occupancyRate: confirmed.length
      ? Math.round((confirmed.length / (confirmed.length + cancelled.length)) * 100)
      : 100,
  });
});

app.get('/api/admin/clients', requireAdmin, (_req, res) => {
  const store = readStore();
  const map = new Map();

  for (const b of store.bookings) {
    if (b.status === 'cancelled') continue;
    const key = b.phone;
    if (!map.has(key)) {
      map.set(key, {
        phone: key,
        name: b.name || '',
        email: b.email || '',
        visits: 0,
        lastVisit: null,
        notes: store.clientNotes[key] || '',
        history: [],
      });
    }
    const c = map.get(key);
    c.visits++;
    if (b.name && !c.name) c.name = b.name;
    if (b.email && !c.email) c.email = b.email;
    c.history.push({
      id: b.id,
      date: b.date,
      time: b.time,
      status: b.status,
      serviceId: b.serviceId || null,
      serviceName: b.serviceName || null,
      paymentMethod: b.paymentMethod || null,
    });
    if (!c.lastVisit || b.date > c.lastVisit) c.lastVisit = b.date;
  }

  const clients = [...map.values()]
    .map((c) => ({
      ...c,
      history: c.history.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)),
    }))
    .sort((a, b) => (b.lastVisit || '').localeCompare(a.lastVisit || ''));

  res.json(clients);
});

app.put('/api/admin/clients/:phone/notes', requireAdmin, (req, res) => {
  const store = readStore();
  const phone = decodeURIComponent(req.params.phone);
  store.clientNotes[phone] = req.body.notes || '';
  writeStore(store);
  res.json({ ok: true, notes: store.clientNotes[phone] });
});

app.get('/api/admin/export/agenda', requireAdmin, (_req, res) => {
  const store = readStore();
  const rows = store.bookings
    .filter((b) => b.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  const header = 'Date,Heure,Client,Téléphone,Prestation,Statut,Paiement\n';
  const body = rows.map((b) =>
    [b.date, b.time, b.name || '', b.phone, b.serviceName || '', b.status, b.paymentMethod || ''].join(',')
  ).join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="agenda-lk-studio.csv"');
  res.send('\uFEFF' + header + body);
});

app.get('/api/admin/notifications', requireAdmin, (_req, res) => {
  res.json(notifications.readLog().slice(-50).reverse());
});

app.post('/api/admin/notifications/test', requireAdmin, async (_req, res) => {
  const store = readStore();
  const fake = {
    name: 'Test',
    phone: store.settings.salonPhone || '0600000000',
    date: new Date().toISOString().slice(0, 10),
    time: '10:00',
    serviceName: 'Coupe',
  };
  const result = await notifications.notifyBooking('confirmation', fake, store.settings);
  res.json({ ok: true, result });
});

app.post('/api/create-booking-intent', async (req, res) => {
  const { date, time, userId, phone, name, email, serviceId, serviceName } = req.body || {};
  if (!date || !time || !userId || !phone) {
    return res.status(400).json({ error: 'Champs requis manquants' });
  }

  const store = purgeExpiredPending(readStore());

  if (isSlotBlocked(store, date, time)) {
    return res.status(409).json({ error: 'Créneau indisponible' });
  }

  const conflict = store.bookings.find(
    (b) => b.date === date && b.time === time && b.status !== 'cancelled'
  );
  if (conflict) {
    return res.status(409).json({ error: 'Créneau déjà pris' });
  }

  const bookingId = uuidv4();
  const pendingUntil = new Date(
    Date.now() + store.settings.pendingTimeoutSec * 1000
  ).toISOString();

  const booking = {
    id: bookingId,
    date,
    time,
    userId,
    phone,
    name: name || '',
    email: email || '',
    serviceId: serviceId || null,
    serviceName: serviceName || null,
    status: 'pending',
    createdAt: new Date().toISOString(),
    pendingUntil,
  };

  store.bookings.push(booking);
  writeStore(store);

  const depositAmount = store.settings.depositAmount;

  if (payments.isStripeEnabled()) {
    try {
      const session = await payments.createCheckoutSession(booking, depositAmount);
      booking.stripeSessionId = session.id;
      writeStore(store);
      return res.json({
        bookingId,
        depositAmount,
        stripeMode: true,
        checkoutUrl: session.url,
        publishableKey: payments.getPublishableKey(),
      });
    } catch (err) {
      store.bookings = store.bookings.filter((b) => b.id !== bookingId);
      writeStore(store);
      return res.status(500).json({ error: 'Erreur Stripe: ' + err.message });
    }
  }

  res.json({ bookingId, depositAmount, stripeMode: false });
});

app.post('/api/confirm-booking', (req, res) => {
  const { bookingId } = req.body || {};
  if (!bookingId) return res.status(400).json({ error: 'bookingId requis' });

  const booking = confirmBookingById(bookingId, { paymentMethod: 'simulated', paidAmount: readStore().settings.depositAmount });
  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });
  res.json({ ok: true, booking });
});

app.get('/api/payment/verify', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id requis' });

  try {
    const session = await payments.getSession(session_id);
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Paiement non finalisé' });
    }
    const booking = confirmBookingById(session.metadata.bookingId, {
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent,
      paidAmount: (session.amount_total || 0) / 100,
      paymentMethod: 'stripe',
    });
    res.json({ ok: true, booking });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cancel-pending', (req, res) => {
  const { bookingId } = req.body || {};
  const store = readStore();
  store.bookings = store.bookings.filter((b) => b.id !== bookingId);
  writeStore(store);
  res.json({ ok: true });
});

app.post('/api/cancel-booking', async (req, res) => {
  const { bookingId } = req.body || {};
  const store = readStore();
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });

  if (booking.paymentMethod === 'stripe' && booking.stripePaymentIntentId) {
    await payments.refundBooking(booking);
  }

  booking.status = 'cancelled';
  booking.cancelledAt = new Date().toISOString();
  writeStore(store);

  if (store.settings.notificationsEnabled !== false) {
    notifications.notifyBooking('cancellation', booking, store.settings);
  }

  res.json({ ok: true, refunded: booking.paymentMethod === 'stripe' });
});

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.add(token);
  res.json({ token });
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  const allowed = [
    'workDays', 'offDays', 'cycleAnchor', 'patternInterval',
    'openingHour', 'closingHour', 'slotIntervalMin',
    'pendingTimeoutSec', 'depositAmount', 'adminComment', 'salonPhone',
    'salonAddress', 'services', 'notificationsEnabled',
  ];
  const store = readStore();
  for (const key of allowed) {
    if (req.body[key] !== undefined) store.settings[key] = req.body[key];
  }
  writeStore(store);
  res.json({
    ...store.settings,
    stripeEnabled: payments.isStripeEnabled(),
    stripePublishableKey: payments.getPublishableKey(),
    scheduleLabel: schedule.cycleLabel(store.settings),
  });
});

app.post('/api/admin/blocked-slots', requireAdmin, (req, res) => {
  const { date, time, reason } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Date requise' });

  const store = readStore();
  const entry = {
    id: uuidv4(),
    date,
    time: time || null,
    reason: reason || '',
    createdAt: new Date().toISOString(),
  };
  store.blockedSlots.push(entry);
  writeStore(store);
  res.json(entry);
});

app.delete('/api/admin/blocked-slots/:id', requireAdmin, (req, res) => {
  const store = readStore();
  store.blockedSlots = store.blockedSlots.filter((b) => b.id !== req.params.id);
  writeStore(store);
  res.json({ ok: true });
});

app.delete('/api/admin/bookings/:id', requireAdmin, async (req, res) => {
  const store = readStore();
  const booking = store.bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Réservation introuvable' });

  if (booking.paymentMethod === 'stripe') await payments.refundBooking(booking);

  booking.status = 'cancelled';
  booking.cancelledAt = new Date().toISOString();
  writeStore(store);
  notifications.notifyBooking('cancellation', booking, store.settings);
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`LK Studio Barber — http://localhost:${PORT}`);
  console.log(`  Stripe: ${payments.isStripeEnabled() ? 'activé' : 'simulation'}`);
  console.log(`  Notifications: ${process.env.SMTP_HOST ? 'SMTP' : 'simulation (journal local)'}`);
  notifications.startReminderScheduler(readStore, writeStore);
});
