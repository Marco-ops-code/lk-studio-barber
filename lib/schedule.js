/** Logique planning : N jours ouvrés + M jours off (cycle répété) */

function getCycleAnchor(settings) {
  if (settings.cycleAnchor) return new Date(settings.cycleAnchor + 'T12:00:00');
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

function isOpenDay(isoDate, settings) {
  const work = Math.max(1, settings.workDays ?? 2);
  const off = Math.max(0, settings.offDays ?? 2);
  const cycle = work + off;
  if (cycle <= work) return true;

  const anchor = getCycleAnchor(settings);
  anchor.setHours(0, 0, 0, 0);
  const d = new Date(isoDate + 'T12:00:00');
  const diffDays = Math.floor((d - anchor) / (24 * 3600 * 1000));
  const pos = ((diffDays % cycle) + cycle) % cycle;
  return pos < work;
}

function cycleLabel(settings) {
  const w = settings.workDays ?? 2;
  const o = settings.offDays ?? 2;
  if (o === 0) return 'Ouvert tous les jours';
  return `${w} jour${w > 1 ? 's' : ''} ouvré${w > 1 ? 's' : ''} / ${o} jour${o > 1 ? 's' : ''} off`;
}

module.exports = { isOpenDay, cycleLabel, getCycleAnchor };
