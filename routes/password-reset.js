const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDB } = require('../database');
const { sendPasswordReset } = require('../utils/email');

// Forgot password page
router.get('/forgot-password', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/forgot-password', { title: 'نسيت كلمة المرور' });
});

// Forgot password handler
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    req.session.error_msg = 'يرجى إدخال البريد الإلكتروني';
    return res.redirect('/forgot-password');
  }

  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE email = ?', email);

  // Always show success to prevent email enumeration
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

    // Save token
    db.runStmt(
      'INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)',
      email, token, expiresAt
    );

    // Send email
    await sendPasswordReset(email, token);
  }

  req.session.success_msg = 'إذا كان البريد مسجلاً لدينا، سيتم إرسال رابط إعادة التعيين';
  res.redirect('/login');
});

// Reset password page
router.get('/reset-password', (req, res) => {
  const { token, email } = req.query;

  if (!token || !email) {
    req.session.error_msg = 'رابط غير صالح';
    return res.redirect('/login');
  }

  const db = getDB();
  const reset = db.get(
    'SELECT * FROM password_resets WHERE email = ? AND token = ? AND used = 0 AND expires_at > datetime("now")',
    email, token
  );

  if (!reset) {
    req.session.error_msg = 'رابط غير صالح أو منتهي الصلاحية';
    return res.redirect('/login');
  }

  res.render('auth/reset-password', { title: 'إعادة تعيين كلمة المرور', token, email });
});

// Reset password handler
router.post('/reset-password', (req, res) => {
  const { token, email, password, confirm_password } = req.body;

  if (!password || password.length < 6) {
    req.session.error_msg = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    return res.redirect(`/reset-password?token=${token}&email=${encodeURIComponent(email)}`);
  }

  if (password !== confirm_password) {
    req.session.error_msg = 'كلمة المرور غير متطابقة';
    return res.redirect(`/reset-password?token=${token}&email=${encodeURIComponent(email)}`);
  }

  const db = getDB();
  const reset = db.get(
    'SELECT * FROM password_resets WHERE email = ? AND token = ? AND used = 0 AND expires_at > datetime("now")',
    email, token
  );

  if (!reset) {
    req.session.error_msg = 'رابط غير صالح أو منتهي الصلاحية';
    return res.redirect('/login');
  }

  // Update password
  const hashedPassword = bcrypt.hashSync(password, 10);
  db.runStmt("UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?", hashedPassword, email);

  // Mark token as used
  db.runStmt("UPDATE password_resets SET used = 1 WHERE id = ?", reset.id);

  req.session.success_msg = 'تم تغيير كلمة المرور بنجاح، يمكنك تسجيل الدخول الآن';
  res.redirect('/login');
});

module.exports = router;
