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
  const { name, email, phone, password, confirm_password, role, id_photo_data } = req.body;
  const userRole = (role === 'consultant') ? 'consultant' : 'client';
  
  // Format phone with 966 prefix
  let formattedPhone = phone || '';
  formattedPhone = formattedPhone.replace(/[^0-9]/g, '');
  if (formattedPhone.startsWith('966')) formattedPhone = formattedPhone;
  else if (formattedPhone.startsWith('05')) formattedPhone = '966' + formattedPhone.slice(1);
  else if (formattedPhone.startsWith('5')) formattedPhone = '966' + formattedPhone;
  else if (formattedPhone) formattedPhone = '966' + formattedPhone;

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

  // 🆔 National ID required for clients
  if (userRole === 'client' && !req.file && !id_photo_data) {
    req.session.error_msg = 'يرجى تصوير الهوية الوطنية أو رفع صورة لها';
    return res.redirect('/register');
  }

  const db = getDB();

  try {
    const existing = db.get('SELECT id, is_active FROM users WHERE email = ?', email);
    if (existing) {
      // If account exists but email not verified, delete it so user can re-register
      const verif = db.get("SELECT id FROM email_verifications WHERE email = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1", email);
      if (!existing.is_active && verif) {
        db.runStmt('DELETE FROM email_verifications WHERE email = ?', email);
        db.runStmt('DELETE FROM users WHERE id = ?', existing.id);
      } else {
        req.session.error_msg = 'البريد الإلكتروني مستخدم بالفعل';
        return res.redirect('/register');
      }
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    // منع تسجيل حساب إداري من صفحة التسجيل (للأمان)

    const result = db.runStmt(
      'INSERT INTO users (name, email, phone, password, role, is_active) VALUES (?, ?, ?, ?, ?, 0)'
    , name, email, phone || null, hashedPassword, userRole);

    // If consultant, create profile
    if (userRole === 'consultant') {
      db.runStmt('INSERT INTO consultants (user_id, bio) VALUES (?, ?)', result.lastInsertRowid, '');
    }

    // 🆔 Process National ID for clients
    const userId = result.lastInsertRowid;
    if (userRole === 'client' && (req.file || id_photo_data)) {
      let imagePath, fullPath;
      
      if (req.file) {
        // File upload
        imagePath = '/uploads/ids/' + req.file.filename;
        fullPath = req.file.path;
      } else if (id_photo_data) {
        // Camera capture (base64)
        const matches = id_photo_data.match(/^data:image\/(\w+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          const filename = 'id-cam-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
          const idsDir = path.join(__dirname, '..', 'public', 'uploads', 'ids');
          if (!fs.existsSync(idsDir)) fs.mkdirSync(idsDir, { recursive: true });
          fullPath = path.join(idsDir, filename);
          fs.writeFileSync(fullPath, Buffer.from(matches[2], 'base64'));
          imagePath = '/uploads/ids/' + filename;
        }
      }
      
      if (imagePath) {
        try {
          const { scanNationalId } = require('../utils/ocr');
          const ocrResult = await scanNationalId(fullPath);
          
          const fields = ocrResult.fields || {};
          const hasData = fields.id_number || fields.full_name;
          
          db.runStmt(`
            INSERT INTO identity_verifications 
              (user_id, full_name, id_number, issuer, issue_date, expiry_date, birth_date, age, ocr_raw_text, image_path, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, userId,
            fields.full_name || null,
            fields.id_number || null,
            fields.issuer || null,
            fields.issue_date || null,
            fields.expiry_date || null,
            fields.birth_date || null,
            fields.age || null,
            ocrResult.rawText.slice(0, 1000) || null,
            imagePath,
            hasData ? 'pending' : 'pending'  // Always pending — admin reviews either way
          );
          
          // If OCR couldn't extract data, save anyway for admin review
          if (!hasData) {
            console.log('⚠️ OCR could not extract data from ID for user', userId);
          }
        } catch(ocrErr) {
          console.error('OCR error:', ocrErr.message);
          db.runStmt(`
            INSERT INTO identity_verifications (user_id, image_path, status)
            VALUES (?, ?, 'pending')
          `, userId, imagePath);
        }
      }
    }
    // 📧 Send verification code to email (code NOT shown in URL)
    const { sendVerificationCode, generateCode } = require('../utils/email');
    const verifCode = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
    db.runStmt('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)',
      userId, email, verifCode, expiresAt);
    sendVerificationCode(email, name, verifCode).catch(() => {});
    
    req.session.success_msg = 'تم إنشاء الحساب! أدخل رمز التفعيل المرسل إلى بريدك الإلكتروني';
    res.redirect('/verify?email=' + encodeURIComponent(email));
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

// ✅ Email/WhatsApp verification page
router.get('/verify', (req, res) => {
  const email = req.query.email || '';
  const wa = req.query.wa || '';
  const code = req.query.code || '';
  if (!email) return res.redirect('/login');
  res.render('auth/verify', { title: 'تأكيد البريد', email, wa, code });
});

router.post('/verify', (req, res) => {
  const db = getDB();
  const { email, code } = req.body;
  if (!email || !code) {
    req.session.error_msg = 'يرجى إدخال رمز التفعيل';
    return res.redirect('/verify?email=' + encodeURIComponent(email));
  }
  
  const verification = db.get('SELECT * FROM email_verifications WHERE email = ? AND code = ? AND verified = 0 AND expires_at > datetime("now") ORDER BY created_at DESC LIMIT 1', email, code);
  if (!verification) {
    req.session.error_msg = 'رمز التفعيل غير صحيح أو منتهي الصلاحية';
    return res.redirect('/verify?email=' + encodeURIComponent(email));
  }
  
  db.runStmt('UPDATE email_verifications SET verified = 1 WHERE id = ?', verification.id);
  db.runStmt('UPDATE users SET is_active = 1 WHERE email = ?', email);
  
  req.session.success_msg = '✅ تم تفعيل البريد الإلكتروني بنجاح! يمكنك تسجيل الدخول الآن';
  res.redirect('/login');
});

// 🔄 Resend verification code
router.get('/resend-code', (req, res) => {
  const db = getDB();
  const email = req.query.email || '';
  if (!email) return res.redirect('/login');
  
  const user = db.get('SELECT id, name, email FROM users WHERE email = ?', email);
  if (!user) return res.redirect('/register');
  
  const { sendVerificationCode, generateCode } = require('../utils/email');
  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  db.runStmt('INSERT INTO email_verifications (user_id, email, code, expires_at) VALUES (?, ?, ?, ?)',
    user.id, email, code, expiresAt);
  sendVerificationCode(email, user.name, code).catch(() => {});
  
  req.session.success_msg = 'تم إعادة إرسال رمز التفعيل';
  res.redirect('/verify?email=' + encodeURIComponent(email));
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
    // Check if unverified email
    const pendingVerif = db.get('SELECT id FROM email_verifications WHERE email = ? AND verified = 0 ORDER BY created_at DESC LIMIT 1', email);
    if (pendingVerif) {
      req.session.error_msg = 'بريدك الإلكتروني غير مفعّل. يرجى التحقق من بريدك الإلكتروني';
      return res.redirect('/verify?email=' + encodeURIComponent(email));
    }
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