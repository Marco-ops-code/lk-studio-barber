/* LK Studio BarberShop — Frontend v3 (Phases 2 & 3) */

function resolveApiBase() {
  const { protocol, hostname, port } = window.location;
  if (protocol === 'file:') return 'http://127.0.0.1:3000';
  if ((hostname === 'localhost' || hostname === '127.0.0.1') && port && port !== '3000') {
    return 'http://127.0.0.1:3000';
  }
  return '';
}

const API = resolveApiBase();
const APP_URL = 'http://localhost:3000';
const STORAGE = { user: 'lk_user', adminToken: 'lk_admin_token', theme: 'lk_theme' };

let settings = {};
let bookings = [];
let blockedSlots = [];
let clients = [];
let currentDate = new Date();
let selectedDate = null;
let selectedTime = null;
let selectedService = null;
let selectedClient = null;
let bookingStep = 1;
let currentUser = loadUser();
let adminToken = localStorage.getItem(STORAGE.adminToken);
let activePanel = 'reserve';

const $ = (id) => document.getElementById(id);

function loadUser() {
  const saved = localStorage.getItem(STORAGE.user);
  if (saved) return JSON.parse(saved);
  const user = { id: 'u_' + Math.random().toString(36).slice(2, 9), isAdmin: false };
  localStorage.setItem(STORAGE.user, JSON.stringify(user));
  return user;
}

function adminHeaders() {
  return adminToken ? { 'x-admin-token': adminToken } : {};
}

async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      headers: { 'Content-Type': 'application/json', ...adminHeaders(), ...opts.headers },
      ...opts,
    });
  } catch {
    throw { network: true, message: 'Serveur injoignable' };
  }
  const ct = res.headers.get('content-type') || '';
  const data = res.ok && ct.includes('application/json')
    ? await res.json().catch(() => null)
    : null;
  if (!res.ok) throw { status: res.status, data };
  if (data === null && path.startsWith('/api/')) {
    throw { network: true, message: 'Réponse invalide du serveur — redémarrez-le avec npm start' };
  }
  return data;
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function confirmAction(message) {
  return window.confirm(message);
}

/* ── Theme ── */
function initTheme() {
  const saved = localStorage.getItem(STORAGE.theme) || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  updateThemeMeta(saved);
  updateThemeLabel(saved);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(STORAGE.theme, next);
  updateThemeMeta(next);
  updateThemeLabel(next);
}

function updateThemeMeta(theme) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#0a0a0a' : '#f4f4f5';
}

function updateThemeLabel(theme) {
  const label = document.querySelector('.theme-label');
  if (label) label.textContent = theme === 'dark' ? 'Mode clair' : 'Mode sombre';
}

/* ── Navigation ── */
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebarBackdrop').classList.remove('hidden');
  $('sidebarBackdrop').classList.add('visible');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarBackdrop').classList.add('hidden');
  $('sidebarBackdrop').classList.remove('visible');
}

function syncNavButtons(name) {
  document.querySelectorAll('.nav-btn[data-panel], .bottom-nav-btn[data-panel]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.panel === name);
  });
}

function showPanel(name) {
  activePanel = name;
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  $('panel-' + name)?.classList.add('active');
  syncNavButtons(name);
  closeSidebar();

  const titles = {
    reserve: 'Réserver un créneau',
    dashboard: 'Tableau de bord',
    agenda: 'Agenda',
    clients: 'Clients',
    settings: 'Paramètres',
  };
  $('pageTitle').textContent = titles[name] || 'LK Studio';

  if (name === 'dashboard') renderDashboard();
  if (name === 'agenda') renderAgenda();
  if (name === 'clients') renderClients();
  if (name === 'settings') renderSettings();
}

function updateNavLock() {
  document.querySelectorAll('[data-admin]').forEach((btn) => {
    btn.classList.toggle('locked', !currentUser.isAdmin);
  });
}

function handleNavClick(btn) {
  if (btn.classList.contains('locked')) { openLoginModal(); return; }
  showPanel(btn.dataset.panel);
}

/* ── Data ── */
function showConnectionError(msg) {
  toast(msg, 'error');
  const banner = $('connectionBanner');
  if (banner) {
    banner.hidden = false;
    banner.querySelector('.banner-text').textContent = msg;
    const hint = banner.querySelector('.banner-hint');
    if (hint) {
      const via = window.location.protocol === 'file:'
        ? 'Fichier HTML ouvert directement.'
        : `Page ouverte sur le port ${window.location.port || '?'}.`;
      hint.textContent = `${via} Utilisez ${APP_URL} après npm start.`;
    }
  }
}

function hideConnectionBanner() {
  const banner = $('connectionBanner');
  if (banner) banner.hidden = true;
}

async function loadAll() {
  try {
    const [sRes, bRes, blRes] = await Promise.allSettled([
      api('/api/settings'),
      api('/api/bookings'),
      api('/api/blocked-slots'),
    ]);

    if (sRes.status === 'rejected') throw sRes.reason;

    settings = sRes.value;
    bookings = bRes.status === 'fulfilled' ? bRes.value : [];
    blockedSlots = blRes.status === 'fulfilled' && Array.isArray(blRes.value) ? blRes.value : [];

    hideConnectionBanner();
    updateDepositDisplay();
    updateSalonInfo();
    updateScheduleHints();
    updatePaymentModeHint();
    renderServices();
    updateStatusBadges();
    if (activePanel === 'reserve') renderCalendar();
    checkCancelButton();
  } catch (err) {
    const msg = err?.network
      ? 'Serveur arrêté — lancez npm start dans le dossier STUDIO LK, puis ouvrez http://localhost:3000'
      : (err?.data?.error || 'Connexion au serveur impossible');
    showConnectionError(msg);
  }
}

function isDayBlocked(iso) {
  return blockedSlots.some((b) => b.date === iso && !b.time);
}

function isSlotBlocked(iso, time) {
  if (isDayBlocked(iso)) return true;
  return blockedSlots.some((b) => b.date === iso && b.time === time);
}

function updateDepositDisplay() {
  const dep = settings.depositAmount ?? 15;
  if ($('sumDeposit')) $('sumDeposit').textContent = dep + ' €';
}

function updateSalonInfo() {
  const el = $('salonInfo');
  if (!el) return;
  const parts = [];
  if (settings.salonPhone) parts.push(`📞 ${settings.salonPhone}`);
  if (settings.salonAddress) parts.push(`📍 ${settings.salonAddress}`);
  el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('');
}

function startOfDayISO(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

function isOpenDay(isoDate) {
  if (isDayBlocked(isoDate)) return false;
  const work = settings.workDays ?? 2;
  const off = settings.offDays ?? 2;
  const cycle = work + off;
  if (off === 0) return true;

  const anchor = settings.cycleAnchor
    ? new Date(settings.cycleAnchor + 'T12:00:00')
    : (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; })();
  anchor.setHours(0, 0, 0, 0);

  const d = new Date(isoDate + 'T12:00:00');
  const diffDays = Math.floor((d - anchor) / (24 * 3600 * 1000));
  const pos = ((diffDays % cycle) + cycle) % cycle;
  return pos < work;
}

function updateScheduleHints() {
  const label = settings.scheduleLabel || `${settings.workDays ?? 2}j ouvrés / ${settings.offDays ?? 2}j off`;
  const hint = $('scheduleHint');
  const calHint = $('calendarScheduleHint');
  if (hint) hint.textContent = '📅 Planning : ' + label;
  if (calHint) calHint.textContent = 'Jours ouverts : ' + label;
}

function formatDateFR(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

/* ── Services ── */
function renderServices() {
  const grid = $('servicesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const services = settings.services || [];
  if (!services.length) {
    grid.innerHTML = '<p class="small">Prestations à venir.</p>';
    return;
  }
  services.forEach((s) => {
    const card = document.createElement('div');
    card.className = 'service-card' + (selectedService?.id === s.id ? ' selected' : '');
    card.innerHTML = `
      <div class="service-name">${s.name}</div>
      <div class="service-price">${s.price} €</div>
      <div class="service-desc">${s.description || ''}</div>
      <div class="service-duration">${s.duration} min</div>`;
    card.addEventListener('click', () => {
      selectedService = s;
      renderServices();
      updateSumService();
    });
    grid.appendChild(card);
  });
}

function updateSumService() {
  if ($('sumService')) {
    $('sumService').textContent = selectedService
      ? `${selectedService.name} (${selectedService.price} €)`
      : '—';
  }
}

/* ── Wizard ── */
function setBookingStep(step) {
  bookingStep = step;
  [1, 2, 3, 4].forEach((n) => {
    const el = $('wizardStep' + n);
    if (el) el.hidden = n !== step;
  });

  document.querySelectorAll('.step-item').forEach((item) => {
    const s = parseInt(item.dataset.step, 10);
    item.classList.toggle('active', s === step);
    item.classList.toggle('done', s < step);
  });

  $('calendarCard').hidden = step > 2;
  $('wizardBack').hidden = step <= 1;
  $('wizardNext').hidden = step >= 4;

  if (step === 2) {
    $('wizardNext').disabled = !selectedTime;
    $('wizardNext').textContent = 'Continuer';
  } else if (step === 3) {
    $('wizardNext').disabled = false;
    $('wizardNext').textContent = 'Continuer';
  } else {
    $('wizardNext').disabled = true;
  }
}

function wizardNext() {
  if (bookingStep === 2) {
    if (!selectedTime) return toast('Choisissez un créneau.', 'error');
    setBookingStep(3);
  } else if (bookingStep === 3) {
    const phone = $('phoneInput').value.trim();
    if (!phone) return toast('Renseignez votre téléphone.', 'error');
    updateSumService();
    $('sumDate').textContent = formatDateFR(startOfDayISO(selectedDate));
    $('sumTime').textContent = selectedTime;
    updateDepositDisplay();
    setBookingStep(4);
    $('payBtn').disabled = false;
  }
}

function wizardBack() {
  if (bookingStep === 4) setBookingStep(3);
  else if (bookingStep === 3) setBookingStep(2);
  else if (bookingStep === 2) {
    selectedTime = null;
    setBookingStep(1);
  }
}

function resetBooking() {
  selectedDate = null;
  selectedTime = null;
  bookingStep = 1;
  $('nameInput').value = '';
  $('phoneInput').value = '';
  $('payBtn').disabled = true;
  setBookingStep(1);
  renderCalendar();
}

function updatePaymentModeHint() {
  const el = $('paymentModeHint');
  if (!el) return;
  if (settings.stripeEnabled) {
    el.textContent = 'Paiement sécurisé par carte (Stripe).';
    if ($('payBtn')) $('payBtn').textContent = 'Payer avec Stripe';
  } else {
    el.textContent = 'Mode simulation — le dépôt sera confirmé manuellement.';
    if ($('payBtn')) $('payBtn').textContent = 'Confirmer & payer le dépôt';
  }
}

async function handlePaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const payment = params.get('payment');

  if (payment === 'success') {
    const sessionId = params.get('session_id');
    if (sessionId) {
      try {
        const { booking } = await api('/api/payment/verify?session_id=' + encodeURIComponent(sessionId));
        showConfirmationModal(booking, booking.paidAmount || settings.depositAmount);
        await loadAll();
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        toast('Paiement reçu — actualisez si la réservation n\'apparaît pas.', 'info');
      }
    }
  } else if (payment === 'cancelled') {
    toast('Paiement annulé.', 'info');
    window.history.replaceState({}, '', window.location.pathname);
  }
}

/* ── Calendar ── */
function renderCalendar() {
  $('monthLabel').textContent = currentDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' });
  const body = $('calendarBody');
  body.innerHTML = '';

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  let firstWeekday = first.getDay();
  firstWeekday = firstWeekday === 0 ? 6 : firstWeekday - 1;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayISO = startOfDayISO(today);
  let date = 1;

  for (let r = 0; r < 6; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c < 7; c++) {
      const td = document.createElement('td');
      if ((r === 0 && c < firstWeekday) || date > last.getDate()) {
        td.classList.add('disabled');
      } else {
        const d = new Date(year, month, date);
        const iso = startOfDayISO(d);
        td.textContent = date;
        if (iso === todayISO) td.classList.add('today');
        if (isDayBlocked(iso)) td.classList.add('blocked', 'disabled');
        else if (d < today || !isOpenDay(iso)) td.classList.add('disabled');
        else {
          td.classList.add('open-day');
          if (bookings.some((b) => b.date === iso && b.status === 'confirmed')) td.classList.add('has-booking');
          if (selectedDate && startOfDayISO(selectedDate) === iso) td.classList.add('selected');
          td.addEventListener('click', () => selectDate(d));
        }
        date++;
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
    if (date > last.getDate()) break;
  }
}

function selectDate(d) {
  selectedDate = d;
  selectedTime = null;
  const label = formatDateFR(startOfDayISO(d));
  $('selectedLabel').textContent = label;
  renderCalendar();
  renderSlotsForDate(d);
  setBookingStep(2);

  if (window.innerWidth <= 768) {
    $('bookingPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderSlotsForDate(d) {
  const container = $('slotsContainer');
  const empty = $('slotsEmpty');
  container.innerHTML = '';
  const iso = startOfDayISO(d);
  const open = settings.openingHour ?? 9;
  const close = settings.closingHour ?? 19;
  const step = settings.slotIntervalMin ?? 30;
  let hasSlots = false;

  for (let h = open; h < close; h++) {
    for (let m = 0; m < 60; m += step) {
      const time = String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      const el = document.createElement('div');
      el.className = 'slot';
      el.textContent = time;
      hasSlots = true;

      if (isSlotBlocked(iso, time)) {
        el.classList.add('blocked-slot');
        el.title = 'Indisponible';
      } else {
        const b = bookings.find((x) => x.date === iso && x.time === time && x.status !== 'cancelled');
        if (b) {
          if (b.status === 'confirmed') {
            if (b.userId === currentUser.id) el.classList.add('mine');
            else { el.classList.add('booked'); el.title = 'Réservé'; }
          } else if (b.status === 'pending') {
            if (b.userId === currentUser.id) el.classList.add('mine', 'pending');
            else { el.classList.add('pending', 'pending-other'); el.title = 'Paiement en cours'; }
          }
        } else {
          el.addEventListener('click', () => {
            selectedTime = time;
            container.querySelectorAll('.slot').forEach((s) => s.classList.remove('selected'));
            el.classList.add('selected');
            $('wizardNext').disabled = false;
          });
        }
      }
      container.appendChild(el);
    }
  }
  container.style.display = hasSlots ? 'grid' : 'none';
  if (empty) empty.hidden = hasSlots;
}

/* ── Booking & confirmation ── */
async function handlePay() {
  if (!selectedDate || !selectedTime) return toast('Sélectionnez une date et un créneau.', 'error');
  const phone = $('phoneInput').value.trim();
  const name = $('nameInput').value.trim();
  const email = $('emailInput')?.value.trim() || '';
  if (!phone) return toast('Renseignez votre numéro de téléphone.', 'error');

  $('payBtn').disabled = true;

  try {
    const data = await api('/api/create-booking-intent', {
      method: 'POST',
      body: JSON.stringify({
        date: startOfDayISO(selectedDate),
        time: selectedTime,
        userId: currentUser.id,
        phone,
        name,
        email,
        serviceId: selectedService?.id || null,
        serviceName: selectedService?.name || null,
      }),
    });

    if (data.stripeMode && data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }

    const deposit = data.depositAmount ?? 15;
    if (!confirmAction(`Confirmer le paiement du dépôt de ${deposit} € ?`)) {
      await api('/api/cancel-pending', { method: 'POST', body: JSON.stringify({ bookingId: data.bookingId }) });
      $('payBtn').disabled = false;
      return;
    }

    const result = await api('/api/confirm-booking', {
      method: 'POST',
      body: JSON.stringify({ bookingId: data.bookingId }),
    });

    showConfirmationModal(result.booking || {
      date: startOfDayISO(selectedDate),
      time: selectedTime,
      name,
      phone,
      serviceName: selectedService?.name,
    }, deposit);

    await loadAll();
    $('cancelBtn').disabled = false;
  } catch (e) {
    toast(e.data?.error || e.message || 'Erreur lors de la réservation.', 'error');
    $('payBtn').disabled = false;
    await loadAll();
    if (selectedDate) renderSlotsForDate(selectedDate);
  }
}

function showConfirmationModal(booking, deposit) {
  const recap = $('confirmRecap');
  recap.innerHTML = `
    ${booking.serviceName ? `<div class="recap-row"><span>Prestation</span><strong>${booking.serviceName}</strong></div>` : ''}
    <div class="recap-row"><span>Date</span><strong>${formatDateFR(booking.date)}</strong></div>
    <div class="recap-row"><span>Heure</span><strong>${booking.time}</strong></div>
    <div class="recap-row"><span>Téléphone</span><strong>${booking.phone}</strong></div>
    <div class="recap-row recap-highlight"><span>Dépôt payé</span><strong>${deposit} €</strong></div>`;
  $('confirmModal').hidden = false;
}

function closeConfirmationModal() {
  $('confirmModal').hidden = true;
  resetBooking();
}

async function handleCancel() {
  const mine = bookings.find(
    (b) => b.userId === currentUser.id && (b.status === 'confirmed' || b.status === 'pending')
  );
  if (!mine) return toast('Aucune réservation à annuler.', 'info');
  if (!confirmAction(`Annuler la réservation du ${mine.date} à ${mine.time} ?`)) return;

  try {
    await api('/api/cancel-booking', { method: 'POST', body: JSON.stringify({ bookingId: mine.id }) });
    toast('Réservation annulée.', 'success');
    await loadAll();
    $('cancelBtn').disabled = true;
  } catch (e) {
    toast(e.data?.error || 'Erreur annulation.', 'error');
  }
}

function checkCancelButton() {
  const has = bookings.some(
    (b) => b.userId === currentUser.id && (b.status === 'confirmed' || b.status === 'pending')
  );
  if ($('cancelBtn')) $('cancelBtn').disabled = !has;
}

/* ── Dashboard ── */
async function renderDashboard() {
  if (!currentUser.isAdmin) return;
  try {
    const [stats, advanced] = await Promise.all([
      api('/api/stats'),
      api('/api/stats/advanced'),
    ]);

    $('statToday').textContent = stats.today;
    $('statPending').textContent = stats.pending;
    $('statConfirmed').textContent = stats.confirmed;
    $('statRevenue').textContent = advanced.revenueMonth + '€';

    const list = $('upcomingList');
    list.innerHTML = '';
    if (!stats.upcoming.length) {
      list.innerHTML = '<p class="small">Aucun rendez-vous à venir.</p>';
    } else {
      stats.upcoming.forEach((b, i) => {
        const div = document.createElement('div');
        div.className = 'upcoming-item';
        div.style.animationDelay = i * 0.05 + 's';
        div.innerHTML = `
          <div>
            <strong>${formatDateFR(b.date)}</strong>
            <div class="small">${b.time} — ${b.name || 'Client'} · ${b.phone}${b.serviceName ? ' · ' + b.serviceName : ''}</div>
          </div>
          <span class="status-pill confirmed">Confirmé</span>`;
        list.appendChild(div);
      });
    }

    renderAdvancedStats(advanced);
  } catch {
    $('upcomingList').innerHTML = '<p class="small">Connectez-vous en admin.</p>';
  }
}

function renderAdvancedStats(data) {
  const el = $('advancedStats');
  if (!el) return;
  const maxBar = Math.max(...data.weekDays.map((d) => d.count), 1);

  el.innerHTML = `
    <div class="stat-row"><span>Revenus Stripe</span><strong>${data.stripeRevenue || 0} €</strong></div>
    <div class="stat-row"><span>Nouveaux clients ce mois</span><strong>${data.newClientsMonth}</strong></div>
    <div class="stat-row"><span>Annulations</span><strong>${data.cancelled}</strong></div>
    <div class="stat-row"><span>Taux de remplissage</span><strong>${data.occupancyRate}%</strong></div>
    <div class="stat-row"><span>Heure de pointe</span><strong>${data.hourPeak}</strong></div>
    <div style="margin-top:8px">
      <p class="small" style="margin-bottom:8px">RDV par jour de la semaine</p>
      <div class="bar-chart">
        ${data.weekDays.map((d) => `
          <div class="bar-row">
            <span class="bar-label">${d.label}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round((d.count / maxBar) * 100)}%"></div></div>
            <span class="bar-count">${d.count}</span>
          </div>`).join('')}
      </div>
    </div>`;
}

/* ── Agenda ── */
function renderAgenda() {
  if (!currentUser.isAdmin) return;

  const sorted = [...bookings]
    .filter((b) => b.status !== 'cancelled')
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  $('agendaCount').textContent = sorted.length;
  const tbody = $('agendaBody');
  tbody.innerHTML = '';
  const cards = $('agendaCards');
  cards.innerHTML = '';

  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="small" style="text-align:center;padding:24px">Aucune réservation.</td></tr>';
    cards.innerHTML = '<p class="small" style="text-align:center;padding:16px">Aucune réservation.</p>';
    return;
  }

  sorted.forEach((b, i) => {
    const statusLabel = b.status === 'confirmed' ? 'Confirmé' : 'En attente';
    const service = b.serviceName ? ` · ${b.serviceName}` : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${b.date}</td><td>${b.time}</td>
      <td>${b.name || '—'}${service}</td><td>${b.phone}</td>
      <td><span class="status-pill ${b.status}">${statusLabel}</span></td>
      <td><button class="btn btn-danger btn-sm" type="button">Annuler</button></td>`;
    tr.querySelector('button').addEventListener('click', () => adminCancelBooking(b.id));
    tbody.appendChild(tr);

    const card = document.createElement('div');
    card.className = 'agenda-card';
    card.style.animationDelay = i * 0.04 + 's';
    card.innerHTML = `
      <div class="agenda-card-top">
        <span class="agenda-card-date">${b.date} · ${b.time}</span>
        <span class="status-pill ${b.status}">${statusLabel}</span>
      </div>
      <div class="agenda-card-meta">${b.name || 'Client'} — ${b.phone}${service}</div>
      <button class="btn btn-danger btn-sm" style="margin-top:10px" type="button">Annuler</button>`;
    card.querySelector('button').addEventListener('click', () => adminCancelBooking(b.id));
    cards.appendChild(card);
  });
}

async function adminCancelBooking(id) {
  if (!confirmAction('Annuler cette réservation ?')) return;
  try {
    await api('/api/admin/bookings/' + id, { method: 'DELETE' });
    toast('Réservation annulée.', 'success');
    await loadAll();
    renderAgenda();
    renderDashboard();
  } catch (e) {
    toast(e.data?.error || 'Erreur.', 'error');
  }
}

/* ── Clients ── */
async function renderClients() {
  if (!currentUser.isAdmin) return;
  try {
    clients = await api('/api/admin/clients');
    $('clientsCount').textContent = clients.length;
    filterClients($('clientSearch')?.value || '');
  } catch {
    $('clientsList').innerHTML = '<p class="small">Erreur chargement clients.</p>';
  }
}

function filterClients(query) {
  const list = $('clientsList');
  const q = query.toLowerCase().trim();
  const filtered = q
    ? clients.filter((c) => c.name.toLowerCase().includes(q) || c.phone.includes(q))
    : clients;

  list.innerHTML = '';
  if (!filtered.length) {
    list.innerHTML = '<p class="small">Aucun client trouvé.</p>';
    return;
  }

  filtered.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'client-row';
    row.innerHTML = `
      <div>
        <div class="client-row-name">${c.name || 'Client'}</div>
        <div class="client-row-meta">${c.phone} · Dernière visite : ${c.lastVisit || '—'}</div>
      </div>
      <span class="client-visits">${c.visits} visite${c.visits > 1 ? 's' : ''}</span>`;
    row.addEventListener('click', () => showClientDetail(c));
    list.appendChild(row);
  });
}

function showClientDetail(client) {
  selectedClient = client;
  $('clientDetailCard').hidden = false;
  $('clientDetailName').textContent = client.name || 'Client';
  $('clientDetailPhone').textContent = client.phone + ' · ' + client.visits + ' visite(s)' + (client.email ? ' · ' + client.email : '');
  if ($('clientNotes')) $('clientNotes').value = client.notes || '';

  const hist = $('clientHistory');
  hist.innerHTML = client.history.map((h) => `
    <div class="history-item">
      <span>${formatDateFR(h.date)} à ${h.time}${h.serviceName ? ' — ' + h.serviceName : ''}${h.paymentMethod ? ' (' + h.paymentMethod + ')' : ''}</span>
      <span class="status-pill ${h.status}">${h.status === 'confirmed' ? 'Confirmé' : 'En attente'}</span>
    </div>`).join('');

  $('clientDetailCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function saveClientNotes() {
  if (!selectedClient || !currentUser.isAdmin) return;
  try {
    await api('/api/admin/clients/' + encodeURIComponent(selectedClient.phone) + '/notes', {
      method: 'PUT',
      body: JSON.stringify({ notes: $('clientNotes').value }),
    });
    toast('Notes enregistrées.', 'success');
    await renderClients();
  } catch (e) {
    toast(e.data?.error || 'Erreur.', 'error');
  }
}

async function exportAgenda() {
  if (!currentUser.isAdmin) return;
  try {
    const res = await fetch(API + '/api/admin/export/agenda', { headers: adminHeaders() });
    if (!res.ok) throw new Error('Export échoué');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agenda-lk-studio.csv';
    a.click();
    toast('Agenda exporté.', 'success');
  } catch {
    toast('Erreur export CSV.', 'error');
  }
}

/* ── Settings & blocks ── */
function renderSettings() {
  if (!currentUser.isAdmin) return;
  $('setWorkCycle').value = `${settings.workDays ?? 2}-${settings.offDays ?? 2}`;
  $('setOpen').value = settings.openingHour ?? 9;
  $('setClose').value = settings.closingHour ?? 19;
  $('setSlot').value = settings.slotIntervalMin ?? 30;
  $('setDeposit').value = settings.depositAmount ?? 15;
  $('adminComment').value = settings.adminComment || '';
  $('setSalonPhone').value = settings.salonPhone || '';
  $('setSalonAddress').value = settings.salonAddress || '';
  if ($('setNotifications')) $('setNotifications').checked = settings.notificationsEnabled !== false;
  updateScheduleHints();
  renderBlockedList();
  renderNotificationsLog();
}

async function renderNotificationsLog() {
  const el = $('notificationsLog');
  if (!el || !currentUser.isAdmin) return;
  try {
    const log = await api('/api/admin/notifications');
    if (!log.length) {
      el.innerHTML = '<p class="small">Aucune notification envoyée.</p>';
      return;
    }
    el.innerHTML = log.map((n) => `
      <div class="notif-item status-${n.status || 'sent'}">
        <strong>${n.channel?.toUpperCase()}</strong> → ${n.to || '—'}
        <div>${n.subject || n.body || n.note || ''}</div>
        <div class="notif-meta">${n.at} · ${n.status}</div>
      </div>`).join('');
  } catch {
    el.innerHTML = '<p class="small">Journal indisponible.</p>';
  }
}

async function testNotification() {
  try {
    await api('/api/admin/notifications/test', { method: 'POST' });
    toast('Notification test envoyée (voir journal).', 'success');
    renderNotificationsLog();
  } catch {
    toast('Erreur envoi test.', 'error');
  }
}

function renderBlockedList() {
  const list = $('blockedList');
  if (!list) return;
  list.innerHTML = '';
  if (!blockedSlots.length) {
    list.innerHTML = '<p class="small">Aucun créneau bloqué.</p>';
    return;
  }
  blockedSlots.forEach((b) => {
    const div = document.createElement('div');
    div.className = 'blocked-item';
    div.innerHTML = `
      <div class="blocked-item-info">
        <strong>${b.date}${b.time ? ' · ' + b.time : ' (journée entière)'}</strong>
        ${b.reason ? `<div class="small">${b.reason}</div>` : ''}
      </div>
      <button class="btn btn-danger btn-sm" type="button">Supprimer</button>`;
    div.querySelector('button').addEventListener('click', () => removeBlock(b.id));
    list.appendChild(div);
  });
}

async function addBlock() {
  const date = $('blockDate').value;
  const time = $('blockTime').value || null;
  const reason = $('blockReason').value.trim();
  if (!date) return toast('Choisissez une date.', 'error');

  try {
    await api('/api/admin/blocked-slots', {
      method: 'POST',
      body: JSON.stringify({ date, time, reason }),
    });
    toast('Créneau bloqué.', 'success');
    $('blockDate').value = '';
    $('blockTime').value = '';
    $('blockReason').value = '';
    blockedSlots = await api('/api/blocked-slots');
    renderBlockedList();
    renderCalendar();
  } catch (e) {
    toast(e.data?.error || 'Erreur.', 'error');
  }
}

async function removeBlock(id) {
  try {
    await api('/api/admin/blocked-slots/' + id, { method: 'DELETE' });
    blockedSlots = await api('/api/blocked-slots');
    renderBlockedList();
    renderCalendar();
    toast('Blocage supprimé.', 'info');
  } catch (e) {
    toast(e.data?.error || 'Erreur.', 'error');
  }
}

async function saveSettings() {
  try {
    const [workDays, offDays] = ($('setWorkCycle').value || '2-2').split('-').map(Number);
    settings = await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        workDays,
        offDays,
        openingHour: parseInt($('setOpen').value, 10),
        closingHour: parseInt($('setClose').value, 10),
        slotIntervalMin: parseInt($('setSlot').value, 10),
        depositAmount: parseFloat($('setDeposit').value),
        adminComment: $('adminComment').value,
        salonPhone: $('setSalonPhone').value,
        salonAddress: $('setSalonAddress').value,
        notificationsEnabled: $('setNotifications')?.checked ?? true,
      }),
    });
    updateScheduleHints();
    if (window.LKTyping) {
      document.getElementById('welcomeTyping').dataset.typed = '';
      window.LKTyping.restartWelcomeTyping(settings.adminComment);
    }
    updateDepositDisplay();
    updateSalonInfo();
    toast('Paramètres enregistrés.', 'success');
    renderCalendar();
  } catch (e) {
    toast(e.data?.error || 'Erreur enregistrement.', 'error');
  }
}

/* ── Admin auth ── */
function openLoginModal() {
  $('loginModal').hidden = false;
  $('adminPassword').value = '';
  setTimeout(() => $('adminPassword').focus(), 100);
}

function closeLoginModal() {
  $('loginModal').hidden = true;
}

async function handleAdminLogin() {
  const password = $('adminPassword').value;
  if (!password) return;
  try {
    const { token } = await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    adminToken = token;
    localStorage.setItem(STORAGE.adminToken, token);
    currentUser.isAdmin = true;
    localStorage.setItem(STORAGE.user, JSON.stringify(currentUser));
    closeLoginModal();
    updateNavLock();
    updateStatusBadges();
    toast('Bienvenue dans l\'espace admin.', 'success');
  } catch {
    toast('Mot de passe incorrect.', 'error');
  }
}

function handleAdminLogout() {
  currentUser.isAdmin = false;
  adminToken = null;
  localStorage.removeItem(STORAGE.adminToken);
  localStorage.setItem(STORAGE.user, JSON.stringify(currentUser));
  updateNavLock();
  updateStatusBadges();
  showPanel('reserve');
  toast('Déconnexion admin.', 'info');
}

function updateStatusBadges() {
  $('statusBadge').textContent = 'En ligne';
  const ab = $('adminBadge');
  if (currentUser.isAdmin) {
    ab.textContent = 'Admin';
    ab.hidden = false;
    $('adminLoginBtn').textContent = 'Déconnexion';
  } else {
    ab.hidden = true;
    $('adminLoginBtn').textContent = 'Connexion admin';
  }
}

function hideLoader() {
  const loader = $('appLoader');
  if (loader) {
    loader.classList.add('hidden');
    setTimeout(() => loader.remove(), 500);
  }
}

/* ── Init ── */
async function init() {
  initTheme();
  setBookingStep(1);

  document.querySelectorAll('.nav-btn[data-panel], .bottom-nav-btn[data-panel]').forEach((btn) => {
    btn.addEventListener('click', () => handleNavClick(btn));
  });

  $('menuToggle')?.addEventListener('click', openSidebar);
  $('sidebarBackdrop')?.addEventListener('click', closeSidebar);
  $('themeToggle')?.addEventListener('click', toggleTheme);
  $('prevMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(); });
  $('nextMonth')?.addEventListener('click', () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(); });
  $('wizardNext')?.addEventListener('click', wizardNext);
  $('wizardBack')?.addEventListener('click', wizardBack);
  $('payBtn')?.addEventListener('click', handlePay);
  $('cancelBtn')?.addEventListener('click', handleCancel);
  $('confirmCloseBtn')?.addEventListener('click', closeConfirmationModal);
  $('adminLoginBtn')?.addEventListener('click', () => currentUser.isAdmin ? handleAdminLogout() : openLoginModal());
  $('loginSubmit')?.addEventListener('click', handleAdminLogin);
  $('loginCancel')?.addEventListener('click', closeLoginModal);
  $('saveSettings')?.addEventListener('click', saveSettings);
  $('addBlockBtn')?.addEventListener('click', addBlock);
  $('clientSearch')?.addEventListener('input', (e) => filterClients(e.target.value));
  $('closeClientDetail')?.addEventListener('click', () => { $('clientDetailCard').hidden = true; });
  $('saveClientNotes')?.addEventListener('click', saveClientNotes);
  $('exportAgenda')?.addEventListener('click', exportAgenda);
  $('testNotification')?.addEventListener('click', testNotification);
  $('refreshNotifications')?.addEventListener('click', renderNotificationsLog);
  $('retryConnection')?.addEventListener('click', () => loadAll());
  $('adminPassword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdminLogin(); });

  updateNavLock();
  updateStatusBadges();
  showPanel('reserve');

  await loadAll();
  if (window.LKTyping && settings.adminComment !== undefined) {
    window.LKTyping.runWelcomeTyping(settings.adminComment || 'Bienvenue — réservez votre créneau en quelques clics.');
    if ($('welcomeTyping')) $('welcomeTyping').dataset.typed = '1';
  }
  await handlePaymentReturn();
  hideLoader();

  setInterval(loadAll, 30000);
}

document.addEventListener('DOMContentLoaded', init);
