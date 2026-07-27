// Stripe payment routes for دلني
const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');

// Conditionally load Stripe
let stripe = null;
try {
  if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_placeholder') {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('💳 Stripe initialized');
  } else {
    console.log('💳 Stripe: using simulated payments (set STRIPE_SECRET_KEY in .env for live mode)');
  }
} catch (e) {
  console.log('💳 Stripe not configured, using simulated payments');
}

// Create Stripe Checkout Session
router.post('/create-checkout/:consultationId', requireLogin, requireRole('client'), async (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?",
    req.params.consultationId, req.session.user.id);

  if (!consultation) {
    return res.status(404).json({ error: 'الاستشارة غير موجودة' });
  }

  if (consultation.payment_status === 'paid') {
    return res.json({ error: 'تم الدفع مسبقاً', redirect: '/client' });
  }

  // If Stripe is available, use real Checkout
  if (stripe) {
    try {
      // Get consultant info for the product name
      const consultant = db.get(`
        SELECT u.name FROM consultants con JOIN users u ON u.id = con.user_id WHERE con.id = ?
      `, consultation.consultant_id);

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'sar',
            product_data: {
              name: `استشارة: ${consultation.title || 'استشارة ' + consultation.id}`,
              description: `القسم: ${consultation.category_id} | المستشار: ${consultant?.name || 'مستشار'}`,
            },
            unit_amount: Math.round(consultation.amount * 100), // Stripe uses cents/sar halalas
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${process.env.SITE_URL || 'http://localhost:3000'}/stripe/success?session_id={CHECKOUT_SESSION_ID}&consultation_id=${consultation.id}`,
        cancel_url: `${process.env.SITE_URL || 'http://localhost:3000'}/client/pay/${consultation.id}`,
        metadata: {
          consultation_id: String(consultation.id),
          client_id: String(req.session.user.id)
        }
      });

      return res.json({ url: session.url });
    } catch (err) {
      console.error('Stripe error:', err);
      return res.status(500).json({ error: 'فشل الاتصال ببوابة الدفع' });
    }
  }

  // Simulated payment fallback
  return res.json({ simulate: true, redirect: `/client/pay/${consultation.id}` });
});

// Stripe success page
router.get('/success', requireLogin, async (req, res) => {
  const { session_id, consultation_id } = req.query;
  const db = getDB();

  if (stripe && session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        // Process the payment
        const consultation = db.get("SELECT * FROM consultations WHERE id = ?", consultation_id);
        if (consultation && consultation.payment_status !== 'paid') {
          processPayment(consultation, db, session.payment_intent);
        }
        req.session.success_msg = 'تم الدفع بنجاح عبر Stripe ✅';
        return res.redirect('/client');
      }
    } catch (err) {
      console.error('Stripe verify error:', err);
    }
  }

  req.session.success_msg = 'تم الدفع بنجاح';
  res.redirect('/client');
});

// Helper: process payment
function processPayment(consultation, db, paymentIntent) {
  const paymentId = paymentIntent || ('PAY-' + Date.now());

  db.runStmt(`
    UPDATE consultations SET payment_status = 'paid', payment_id = ?, status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, paymentId, consultation.id);

  db.runStmt(`
    INSERT INTO transactions (user_id, consultation_id, type, amount, platform_fee, consultant_share, status, description, stripe_payment_intent)
    VALUES (?, ?, 'payment', ?, ?, ?, 'completed', ?, ?)
  `, consultation.client_id, consultation.id, consultation.amount, consultation.platform_fee,
    consultation.consultant_earnings, 'دفع رسوم استشارة: ' + (consultation.title || consultation.question.substring(0, 50)),
    paymentId);

  db.runStmt("UPDATE consultations SET status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?", consultation.id);
  db.runStmt("UPDATE consultants SET balance = balance + ? WHERE id = ?", consultation.consultant_earnings, consultation.consultant_id);

  // Notify consultant
  db.runStmt(`
    INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
    VALUES ((SELECT user_id FROM consultants WHERE id = ?), ?, ?, 'info', ?, 'consultation')
  `, consultation.consultant_id, 'استشارة جديدة', 'لديك استشارة جديدة بانتظار ردك', consultation.id);
}

module.exports = router;
