const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { getDB } = require('../database');
const { sendWelcomeEmail } = require('../utils/email');

// 🆔 ID image upload config
const idStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'public', 'uploads', 'ids');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const uploadId = multer({
  storage: idStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('فقط الصور والمستندات مسموحة'));
  }
});

// Register page
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'إنشاء حساب جديد' });
});

// Register handler (with optional ID upload for clients)
router.post('/register', uploadId.single('national_id'), async (req, res) => {
  const { name, email, phone, password, confirm_password, role } = req.body;
  const userRole = (role === 'consultant') ? 'consultant' : 'client';

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
    // منع تسجيل حساب إداري من صفحة التسجيل (للأمان)
    const userRole = (role === 'consultant') ? 'consultant' : 'client';

    const result = db.runStmt(
      'INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)'
    , name, email, phone || null, hashedPassword, userRole);

    // If consultant, create profile
    if (userRole === 'consultant') {
      db.runStmt('INSERT INTO consultants (user_id, bio) VALUES (?, ?)', result.lastInsertRowid, '');
    }

    // 🆔 Process National ID for clients
    const userId = result.lastInsertRowid;
    if (userRole === 'client' && req.file) {
      const imagePath = '/uploads/ids/' + req.file.filename;
      const fullPath = req.file.path;
      
      // Try OCR in background (don't block registration)
      try {
        const { scanNationalId } = require('../utils/ocr');
        const ocrResult = await scanNationalId(fullPath);
        
        const fields = ocrResult.fields || {};
        db.runStmt(`
          INSERT INTO identity_verifications 
            (user_id, full_name, id_number, issuer, issue_date, expiry_date, birth_date, age, ocr_raw_text, image_path, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        `, userId,
          fields.full_name || null,
          fields.id_number || null,
          fields.issuer || null,
          fields.issue_date || null,
          fields.expiry_date || null,
          fields.birth_date || null,
          fields.age || null,
          ocrResult.rawText.slice(0, 1000) || null,
          imagePath
        );
      } catch(ocrErr) {
        console.error('OCR error:', ocrErr.message);
        // Save ID image even if OCR fails
        db.runStmt(`
          INSERT INTO identity_verifications (user_id, image_path, status)
          VALUES (?, ?, 'pending')
        `, userId, imagePath);
      }
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

  // Update online status
  db.runStmt('UPDATE users SET is_online = 1, last_active = CURRENT_TIMESTAMP WHERE id = ?', user.id);

  // 🔒 Regenerate session ID after login (prevents session fixation)
  req.session.regenerate((err) => {
    if (err) console.error('Session regeneration error:', err);
    
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
});

// Logout
router.get('/logout', (req, res) => {
  const db = getDB();
  if (req.session.user) {
    db.runStmt('UPDATE users SET is_online = 0 WHERE id = ?', req.session.user.id);
  }
  req.session.destroy();
  res.redirect('/login');
});

module.exports = router;