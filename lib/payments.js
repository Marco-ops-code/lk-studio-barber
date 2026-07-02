const Stripe = require('stripe');

function isStripeEnabled() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

function getStripe() {
  if (!isStripeEnabled()) return null;
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

function getPublishableKey() {
  return process.env.STRIPE_PUBLISHABLE_KEY || null;
}

function getBaseUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

async function createCheckoutSession(booking, depositAmount) {
  const stripe = getStripe();
  if (!stripe) return null;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(depositAmount * 100),
        product_data: {
          name: 'Dépôt — LK Studio BarberShop',
          description: `RDV ${booking.date} à ${booking.time}${booking.serviceName ? ' — ' + booking.serviceName : ''}`,
        },
      },
      quantity: 1,
    }],
    metadata: { bookingId: booking.id },
    success_url: `${getBaseUrl()}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${getBaseUrl()}/?payment=cancelled&booking_id=${booking.id}`,
  });

  return session;
}

async function handleWebhook(rawBody, signature, confirmBookingFn) {
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: 'Stripe non configuré' };

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'Webhook secret manquant' };

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata?.bookingId;
    if (bookingId) {
      await confirmBookingFn(bookingId, {
        stripeSessionId: session.id,
        stripePaymentIntentId: session.payment_intent,
        paidAmount: (session.amount_total || 0) / 100,
        paymentMethod: 'stripe',
      });
    }
  }

  return { ok: true };
}

async function refundBooking(booking) {
  const stripe = getStripe();
  if (!stripe || !booking.stripePaymentIntentId) return { ok: false, simulated: true };

  try {
    await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getSession(sessionId) {
  const stripe = getStripe();
  if (!stripe || !sessionId) return null;
  return stripe.checkout.sessions.retrieve(sessionId);
}

module.exports = {
  isStripeEnabled,
  getPublishableKey,
  createCheckoutSession,
  handleWebhook,
  refundBooking,
  getSession,
};
