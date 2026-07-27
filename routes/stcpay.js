// STC Pay payment routes for دلني
const express = require('express');
const router = express.Router();
const { getDB, saveDB } = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');

// ─── STC Pay Configuration ───
// In production, set these in .env:
// STCPAY_MERCHANT_ID=your_merchant_id
// STCPAY_API_KEY=your_api_key
// STCPAY_SECRET_KEY=your_secret_key
// STCPAY_MODE=live   # or test

const STCPAY_CONFIG = {
  merchantId: process.env.STCPAY_MERCHANT_ID || 'DELLINI_MERCHANT',
  testMode: !process.env.STCPAY_MERCHANT_ID || process.env.STCPAY_MODE !== 'live',
  apiUrl: process.env.STCPAY_MERCHANT_ID 
    ? 'https://api.stcpay.com.sa/v1' 
    : 'https://sandbox.stcpay.com.sa/v1',
  apiKey: process.env.STCPAY_API_KEY || 'test_key_dellini',
  secretKey: process.env.STCPAY_SECRET_KEY || 'test_secret_dellini'
};

console.log(`💳 STC Pay: ${STCPAY_CONFIG.testMode ? '🔬 TEST MODE' : '🔴 LIVE MODE'} (${STCPAY_CONFIG.merchantId})`);

// ─── Initiate STC Pay Payment ───
router.post('/initiate/:consultationId', requireLogin, requireRole('client'), async (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?",
    req.params.consultationId, req.session.user.id);

  if (!consultation) {
    return res.status(404).json({ success: false, error: 'الاستشارة غير موجودة' });
  }

  if (consultation.payment_status === 'paid') {
    return res.json({ success: false, error: 'تم الدفع مسبقاً', redirect: '/client' });
  }

  const { phone } = req.body;

  if (!phone) {
    return res.json({ success: false, error: 'يرجى إدخال رقم الجوال المسجل في STC Pay' });
  }

  try {
    // In production: call STC Pay API to create a payment request
    // For now, simulate the STC Pay flow
    
    const paymentRef = 'STCPAY-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Save payment reference to consultation
    db.runStmt("UPDATE consultations SET payment_id = ?, payment_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      paymentRef, consultation.id);

    // Create a pending transaction
    db.runStmt(`
      INSERT INTO transactions (user_id, consultation_id, type, amount, platform_fee, consultant_share, status, description, stripe_payment_intent)
      VALUES (?, ?, 'payment', ?, ?, ?, 'pending', ?, ?)
    `, consultation.client_id, consultation.id, consultation.amount, consultation.platform_fee,
      consultation.consultant_earnings,
      'STC Pay: ' + (consultation.title || consultation.question.substring(0, 30)),
      paymentRef);

    saveDB();

    console.log(`💳 STC Pay initiated: ${paymentRef} for consultation #${consultation.id} via ${phone}`);

    // Return success with payment reference
    // In production, this would return a payment URL/deep link
    res.json({
      success: true,
      payment_ref: paymentRef,
      message: 'تم إرسال طلب الدفع. يرجى تأكيد الدفع عبر تطبيق STC Pay.',
      // In production: redirect to STC Pay page or deeplink
      // payment_url: 'https://stcpay.com.sa/pay/' + paymentRef,
      simulate: STCPAY_CONFIG.testMode,
      phone: phone
    });

  } catch (err) {
    console.error('STC Pay error:', err);
    res.json({ success: false, error: 'فشل الاتصال بخدمة STC Pay' });
  }
});

// ─── Verify STC Pay Payment ───
router.post('/verify/:consultationId', requireLogin, requireRole('client'), async (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?",
    req.params.consultationId, req.session.user.id);

  if (!consultation) {
    return res.status(404).json({ success: false, error: 'الاستشارة غير موجودة' });
  }

  if (consultation.payment_status === 'paid') {
    return res.json({ success: true, redirect: '/client' });
  }

  // In test mode, simulate payment verification
  if (STCPAY_CONFIG.testMode) {
    // Process the payment (same as Stripe success)
    const paymentId = consultation.payment_id || ('STCPAY-' + Date.now());
    processSTCPayPayment(consultation, db, paymentId);

    return res.json({
      success: true,
      message: 'تم تأكيد الدفع عبر STC Pay بنجاح',
      redirect: '/client'
    });
  }

  // In production: call STC Pay API to verify payment status
  res.json({ success: false, error: 'لم يتم تأكيد الدفع بعد' });
});

// ─── STC Pay Webhook (for production) ───
router.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  // In production: verify STC Pay webhook signature
  const event = req.body;
  console.log('📡 STC Pay webhook received:', event?.type);

  if (event?.type === 'payment.success') {
    const db = getDB();
    const paymentRef = event.data?.payment_ref;
    if (paymentRef) {
      const consultation = db.get("SELECT * FROM consultations WHERE payment_id = ?", paymentRef);
      if (consultation && consultation.payment_status !== 'paid') {
        processSTCPayPayment(consultation, db, paymentRef);
        console.log(`💳 STC Pay webhook: payment ${paymentRef} processed`);
      }
    }
  }

  res.json({ received: true });
});

// ─── Payment Processing Helper ───
function processSTCPayPayment(consultation, db, paymentRef) {
  // Update consultation
  db.runStmt(`
    UPDATE consultations SET
      payment_status = 'paid',
      status = 'paid',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, consultation.id);

  // Update transaction status
  db.runStmt(`
    UPDATE transactions SET status = 'completed' WHERE stripe_payment_intent = ? AND consultation_id = ?
  `, paymentRef, consultation.id);

  // Auto-assign to consultant
  db.runStmt("UPDATE consultations SET status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?", consultation.id);

  // Update consultant balance
  db.runStmt("UPDATE consultants SET balance = balance + ? WHERE id = ?", consultation.consultant_earnings, consultation.consultant_id);

  // Create notification for consultant
  db.runStmt(`
    INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
    VALUES ((SELECT user_id FROM consultants WHERE id = ?), ?, ?, 'info', ?, 'consultation')
  `, consultation.consultant_id, 'استشارة جديدة', 'لديك استشارة جديدة بانتظار ردك', consultation.id);

  saveDB();
  console.log(`✅ STC Pay payment completed: ${paymentRef} for consultation #${consultation.id}`);
}

module.exports = router;
