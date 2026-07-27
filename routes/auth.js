const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDB } = require('../database');
const { sendWelcomeEmail } = require('../utils/email');

// Register page
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'إنشاء حساب جديد' });
});

// Register handler
router.post('/register', (req, res) => {
  const { name, email, phone, password, confirm_password, role } = req.body;

  if (!name || !email || !password) {
    req.session.error_msg = 'جميع الحقول المطلوبة يجب أن تمتلئ';
    return res.redirect('/register');
  }

  if (password !== confirm_password) {
    req.session.error_msg = 'كلمة المرور غير متطابقة';
    return res.redirect('/register');
  }

  if (password.length < 6) {
    req.session.error_msg = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
    return res.redirect('/register');
  }

  const db = getDB();

  try {
    const existing = db.get('SELECT id FROM users WHERE email = ?', email);
    if (existing) {
      req.session.error_msg = 'البريد الإلكتروني مستخدم بالفعل';
      return res.redirect('/register');
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const userRole = role === 'consultant' ? 'consultant' : role === 'admin' ? 'admin' : 'client';
    // Admin registrations must be approved by existing admin
    // For now, direct admin registration is enabled

    const result = db.runStmt(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)'
    , name, email, phone || null, hashedPassword, userRole);

    // If consultant, create profile
    if (userRole === 'consultant') {
      db.runStmt('INSERT INTO consultants (user_id, bio) VALUES (?, ?)', result.lastInsertRowid, '');
    }

    req.session.success_msg = 'تم إنشاء الحساب بنجاح، يمكنك تسجيل الدخول الآن';
    // Send welcome email (async, don't await)
    sendWelcomeEmail(email, name).catch(() => {});
    res.redirect('/login');
  } catch (err) {
    console.error(err);
    req.session.error_msg = 'حدث خطأ أثناء إنشاء الحساب';
    res.redirect('/register');
  }
});

// Login page
router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'تسجيل الدخول' });
});

// Login handler
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.session.error_msg = 'يرجى إدخال البريد الإلكتروني وكلمة المرور';
    return res.redirect('/login');
  }

  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE email = ?', email);

  if (!user || !bcrypt.compareSync(password, user.password)) {
    req.session.error_msg = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
    return res.redirect('/login');
  }

  if (!user.is_active) {
    req.session.error_msg = 'حسابك معطل، يرجى التواصل مع الإدارة';
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    avatar: user.avatar
  };

  // Load consultant_id if consultant
  if (user.role === 'consultant') {
    const consultant = db.get('SELECT id FROM consultants WHERE user_id = ?', user.id);
    if (consultant) req.session.user.consultant_id = consultant.id;
  }

  req.session.success_msg = `مرحباً بك يا ${user.name}`;

  // Redirect based on role
  const redirectMap = {
    admin: '/admin',
    supervisor: '/admin',
    consultant: '/consultant',
    client: '/client'
  };
  res.redirect(redirectMap[user.role] || '/');
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;