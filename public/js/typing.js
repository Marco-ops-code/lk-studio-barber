/** Animation typing premium — LK Studio */

const TAGLINE = 'Précision. Style. Confiance.';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function typeText(el, text, speed = 42) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('typing-active');
  for (let i = 0; i < text.length; i++) {
    el.textContent += text[i];
    await sleep(speed + Math.random() * 28);
  }
  el.classList.remove('typing-active');
}

async function runWelcomeTyping(welcomeMessage) {
  const welcomeEl = document.getElementById('welcomeTyping');
  const taglineEl = document.getElementById('taglineTyping');
  if (!welcomeEl || !taglineEl) return;

  const msg = welcomeMessage || 'Bienvenue — réservez votre créneau en quelques clics.';
  await typeText(welcomeEl, msg, 38);
  await sleep(400);
  await typeText(taglineEl, TAGLINE, 55);
}

function restartWelcomeTyping(message) {
  runWelcomeTyping(message);
}

window.LKTyping = { runWelcomeTyping, restartWelcomeTyping, TAGLINE };
