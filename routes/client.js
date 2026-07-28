const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendNewConsultationNotification } = require('../utils/email');

// File upload config — 🔒 only images and PDFs allowed
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../public/uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;
    cb(null, name);
  }
});
const upload = multer({ 
  storage, 
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.gif','.webp','.bmp','.pdf','.doc','.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('فقط الصور والمستندات مسموحة'));
  }
});

// 🆔 ID image upload config for settings
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

// All routes require login + client role
router.use(requireLogin);
router.use(requireRole('client'));

// Client dashboard
router.get('/', (req, res) => {
  const db = getDB();
  const consultations = db.all(`
    SELECT cns.*, cat.name_ar as category_name,
      CASE WHEN cns.consultant_id IS NOT NULL THEN u.name ELSE NULL END as consultant_name
    FROM consultations cns
    LEFT JOIN categories cat ON cat.id = cns.category_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users u ON u.id = con.user_id
    WHERE cns.client_id = ?
    ORDER BY cns.created_at DESC
  `, req.session.user.id);

  res.render('client/dashboard', { title: 'لوحة العميل', consultations });
});

// Step 1: Select category
router.get('/new', (req, res) => {
  const db = getDB();
  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order', );
  res.render('client/new-consultation-step1', { title: 'استشارة جديدة', categories });
});

// Step 2: Select consultant
router.get('/new/step2/:categoryId', (req, res) => {
  const db = getDB();
  const categoryId = req.params.categoryId;
  const category = db.get('SELECT * FROM categories WHERE id = ?', categoryId);

  if (!category) {
    req.session.error_msg = 'القسم غير موجود';
    return res.redirect('/client/new');
  }

  const consultants = db.all(`
    SELECT con.*, cc.price, u.name as user_name, u.avatar,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = con.id AND status = 'closed') as completed_count
    FROM consultant_categories cc
    JOIN consultants con ON con.id = cc.consultant_id
    JOIN users u ON u.id = con.user_id
    WHERE cc.category_id = ? AND cc.is_active = 1 AND con.is_verified = 1 AND con.is_available = 1
    ORDER BY con.rating DESC
  `, categoryId);

  res.render('client/new-consultation-step2', { title: 'اختيار المستشار', category, consultants });
});

// Step 3: Write consultation
router.get('/new/step3/:categoryId/:consultantId', (req, res) => {
  const db = getDB();
  const { categoryId, consultantId } = req.params;

  const consultant = db.get(`
    SELECT con.*, cc.price, cc.voice_enabled, cc.voice_price_per_minute, u.name as user_name
    FROM consultant_categories cc
    JOIN consultants con ON con.id = cc.consultant_id
    JOIN users u ON u.id = con.user_id
    WHERE cc.category_id = ? AND con.id = ?
  `, categoryId, consultantId);

  if (!consultant) {
    req.session.error_msg = 'المستشار غير متاح لهذا القسم';
    return res.redirect('/client/new');
  }

  // Get voice call settings
  const settings = {};
  const rows = db.all('SELECT * FROM payment_settings');
  rows.forEach(r => { settings[r.key] = r.value; });

  res.render('client/new-consultation-step3', {
    title: 'كتابة الاستشارة', consultant, categoryId, consultantId,
    settings, voiceEnabled: settings.voice_calls_enabled !== '0'
  });
});

// Submit consultation (creates draft)
router.post('/new/submit', upload.single('attachment'), (req, res) => {
  const db = getDB();
  const { category_id, consultant_id, title, question, hide_identity, is_urgent,
    consultation_type, duration, voice_price_per_min } = req.body;

  if (!question || question.trim().length < 10) {
    req.session.error_msg = 'يجب كتابة سؤال الاستشارة بوضوح (10 أحرف على الأقل)';
    return res.redirect(`/client/new/step3/${category_id}/${consultant_id}`);
  }

  // Server-side phone number filter
  const phonePatterns = [
    /05\d{8}/g, /9665\d{8}/g, /\+\d{10,15}/g, /\b\d{9,10}\b/g
  ];
  let phoneFound = false;
  const phoneMatches = [];
  phonePatterns.forEach(re => {
    const matches = question.match(re);
    if (matches) {
      matches.forEach(m => {
        const digits = m.replace(/[\s\-\+]/g, '');
        if (digits.length >= 9) {
          phoneFound = true;
          phoneMatches.push(m.trim());
        }
      });
    }
  });

  if (phoneFound) {
    // Notify admins
    const admins = db.all("SELECT id FROM users WHERE role IN ('admin','supervisor')");
    admins.forEach(admin => {
      db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
        VALUES (?, ?, ?, 'warning', 0, 'phone_flag')`,
        admin.id,
        '⚠️ محاولة إضافة رقم جوال في الاستشارة',
        `المستخدم ${req.session.user.name} حاول إضافة رقم جوال: ${phoneMatches.join(', ')}.`);
    });
    
    // Block submission
    req.session.error_msg = '❌ يمنع إضافة أرقام الجوال في الاستشارة لأمن المعلومات. الرجاء حذف الأرقام والمحاولة مرة أخرى.';
    return res.redirect(`/client/new/step3/${category_id}/${consultant_id}`);
  }

  // Get price
  const isVoice = consultation_type === 'voice';
  const pricing = db.get('SELECT price, voice_price_per_minute FROM consultant_categories WHERE category_id = ? AND consultant_id = ?', category_id, consultant_id);
  
  let basePrice, amount, durationMinutes;
  if (isVoice) {
    const perMin = parseFloat(voice_price_per_min) || parseFloat(pricing?.voice_price_per_minute) || 5;
    durationMinutes = parseInt(duration) || 15;
    basePrice = perMin * durationMinutes;
  } else {
    basePrice = pricing?.price || 200;
    durationMinutes = 0;
  }
  
  const urgentFee = is_urgent ? basePrice * 0.5 : 0;
  amount = basePrice + urgentFee;
  const platformFee = amount * 0.25;
  const consultantEarnings = amount - platformFee;

  // Generate nickname
  const nickname = 'مستخدم_' + Math.random().toString(36).substring(2, 8);

  const result = db.runStmt(`
    INSERT INTO consultations (client_id, consultant_id, category_id, title, question, attachment_path, is_urgent,
      status, amount, platform_fee, consultant_earnings, client_nickname, hide_identity, type, duration_minutes, voice_call_price)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, ?, ?, ?, ?, ?, ?, ?)
  `, req.session.user.id, consultant_id, category_id, title || null, question,
    req.file ? '/uploads/' + req.file.filename : null,
    is_urgent ? 1 : 0,
    amount, platformFee, consultantEarnings, nickname, hide_identity ? 1 : 0,
    isVoice ? 'voice' : 'text', durationMinutes, isVoice ? basePrice : 0);

  req.session.success_msg = 'تم إنشاء الاستشارة، يرجى إتمام الدفع';
  res.redirect(`/client/pay/${result.lastInsertRowid}`);
});

// Payment page
router.get('/pay/:id', (req, res) => {
  const db = getDB();
  const consultation = db.get(`
    SELECT cns.*, cat.name_ar as category_name
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    WHERE cns.id = ? AND cns.client_id = ?
  `, req.params.id, req.session.user.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/client');
  }

  if (consultation.payment_status === 'paid') {
    req.session.success_msg = 'تم الدفع مسبقاً';
    return res.redirect('/client');
  }

  // Calculate breakdown
  const platformFee = consultation.amount * 0.25;
  const consultantEarns = consultation.amount - platformFee;

  // Get payment gateway settings
  const settings = {};
  const rows = db.all('SELECT * FROM payment_settings');
  rows.forEach(r => { settings[r.key] = r.value; });

  res.render('client/payment', { title: 'إتمام الدفع', consultation, platformFee, consultantEarns, settings });
});

// Process payment (simulated)
router.post('/pay/:id', (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?", req.params.id, req.session.user.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/client');
  }

  if (consultation.payment_status === 'paid') {
    return res.redirect('/client');
  }

  // Simulate payment - in production this would integrate with Stripe
  const paymentId = 'PAY-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

  // Update consultation
  db.runStmt(`
    UPDATE consultations SET
      payment_status = 'paid',
      payment_id = ?,
      status = 'paid',
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, paymentId, consultation.id);

  // Create transaction record
  db.runStmt(`
    INSERT INTO transactions (user_id, consultation_id, type, amount, platform_fee, consultant_share, status, description, stripe_payment_intent)
    VALUES (?, ?, 'payment', ?, ?, ?, 'completed', ?, ?)
  `, req.session.user.id, consultation.id,
    consultation.amount, consultation.platform_fee, consultation.consultant_earnings,
    'دفع رسوم استشارة: ' + consultation.title || consultation.question.substring(0, 50),
    paymentId);

  // Auto-assign to consultant
  db.runStmt(`
    UPDATE consultations SET status = 'assigned', updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, consultation.id);

  // Update consultant balance
  db.runStmt(`
    UPDATE consultants SET balance = balance + ? WHERE id = ?
  `, consultation.consultant_earnings, consultation.consultant_id);

  // Create notification for consultant
  db.runStmt(`
    INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
    VALUES ((SELECT user_id FROM consultants WHERE id = ?), ?, ?, 'new_consultation', ?, 'consultation')
  `, consultation.consultant_id,
    '🔔 استشارة جديدة',
    'لديك استشارة جديدة بانتظار ردك',
    consultation.id);

  // Send email notification to consultant
  const consultantUser = db.get(`
    SELECT u.name, u.email FROM consultants con JOIN users u ON u.id = con.user_id WHERE con.id = ?
  `, consultation.consultant_id);
  if (consultantUser) {
    sendNewConsultationNotification(consultantUser.email, consultantUser.name, consultation.id).catch(() => {});
  }

  req.session.success_msg = 'تم الدفع بنجاح وتم تحويل الاستشارة للمستشار';
  res.redirect('/client');
});

// View consultation details & chat
router.get('/consultation/:id', (req, res) => {
  const db = getDB();
  const consultation = db.get(`
    SELECT cns.*, cat.name_ar as category_name,
      CASE WHEN cns.consultant_id IS NOT NULL THEN u.name ELSE NULL END as consultant_name,
      con.bio as consultant_bio
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users u ON u.id = con.user_id
    WHERE cns.id = ? AND cns.client_id = ?
  `, req.params.id, req.session.user.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/client');
  }

  const messages = db.all(`
    SELECT m.*, u.name as sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.consultation_id = ?
    ORDER BY m.created_at ASC
  `, req.params.id);

  res.render('client/consultation-detail', { title: 'تفاصيل الاستشارة', consultation, messages });
});

// Close consultation
router.post('/close/:id', (req, res) => {
  const db = getDB();
  const { rating, rating_comment } = req.body;

  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?", req.params.id, req.session.user.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/client');
  }

  db.runStmt(`
    UPDATE consultations SET
      status = 'closed',
      rating = ?,
      rating_comment = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, rating || null, rating_comment || null, consultation.id);

  // Update consultant rating
  if (rating) {
    const con = db.get('SELECT * FROM consultants WHERE id = ?', consultation.consultant_id);
    const newCount = (con.rating_count || 0) + 1;
    const newRating = ((con.rating * (con.rating_count || 0)) + parseInt(rating)) / newCount;
    // replaced
    db.runStmt("UPDATE consultants SET rating = ?, rating_count = ? WHERE id = ?", Math.round(newRating * 10) / 10, newCount, consultation.consultant_id);
  }

  // 🔔 Notify consultant: consultation was closed
  if (consultation.consultant_id) {
    const consultantUser = db.get('SELECT user_id FROM consultants WHERE id = ?', consultation.consultant_id);
    if (consultantUser) {
      db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
        VALUES (?, ?, ?, 'closed', ?, 'consultation')`,
        consultantUser.user_id,
        '🔒 تم إغلاق الاستشارة',
        `قام العميل بإغلاق الاستشارة #${consultation.id} ${rating ? 'والتقييم: ' + rating + '/5 ⭐' : ''}`,
        consultation.id);
    }
  }

  // 🔔 Notify admins
  const admins = db.all("SELECT id FROM users WHERE role IN ('admin','supervisor')");
  admins.forEach(admin => {
    db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'info', ?, 'consultation')`,
      admin.id,
      '🔒 استشارة مغلقة',
      `تم إغلاق الاستشارة #${consultation.id} من قبل العميل ${rating ? '- التقييم: ' + rating + '/5' : ''}`,
      consultation.id);
  });

  req.session.success_msg = 'تم إغلاق الاستشارة بنجاح، شكراً لتقييمك';
  res.redirect('/client');
});

// Invoices
router.get('/invoices', (req, res) => {
  const db = getDB();
  const transactions = db.all(`
    SELECT t.*, cns.title, cns.question
    FROM transactions t
    JOIN consultations cns ON cns.id = t.consultation_id
    WHERE t.user_id = ?
    ORDER BY t.created_at DESC
  `, req.session.user.id);

  res.render('client/invoices', { title: 'الفواتير', transactions });
});

// 🆔 إعدادات الحساب — إعادة رفع الهوية
router.get('/settings', (req, res) => {
  const db = getDB();
  const identity = db.get('SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1', req.session.user.id);
  res.render('client/settings', { title: 'إعدادات الحساب', identity });
});

router.post('/settings/upload-id', uploadId.single('national_id'), async (req, res) => {
  if (!req.file) {
    req.session.error_msg = '❌ يرجى اختيار ملف';
    return res.redirect('/client/settings');
  }
  try {
    const db = getDB();
    const imagePath = '/uploads/ids/' + req.file.filename;
    const fullPath = req.file.path;
    
    // Try OCR
    try {
      const { scanNationalId } = require('../utils/ocr');
      const ocrResult = await scanNationalId(fullPath);
      const fields = ocrResult.fields || {};
      
      const existing = db.get('SELECT id FROM identity_verifications WHERE user_id = ?', req.session.user.id);
      if (existing) {
        db.runStmt(`UPDATE identity_verifications SET image_path = ?, full_name = ?, id_number = ?, issuer = ?, issue_date = ?, expiry_date = ?, birth_date = ?, age = ?, ocr_raw_text = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
          imagePath, fields.full_name, fields.id_number, fields.issuer, fields.issue_date, fields.expiry_date, fields.birth_date, fields.age, ocrResult.rawText?.slice(0,1000), req.session.user.id);
      } else {
        db.runStmt(`INSERT INTO identity_verifications (user_id, image_path, full_name, id_number, issuer, issue_date, expiry_date, birth_date, age, ocr_raw_text, status) VALUES (?,?,?,?,?,?,?,?,?,?,'pending')`,
          req.session.user.id, imagePath, fields.full_name, fields.id_number, fields.issuer, fields.issue_date, fields.expiry_date, fields.birth_date, fields.age, ocrResult.rawText?.slice(0,1000));
      }
    } catch(ocrErr) {
      console.error('OCR error:', ocrErr.message);
      const existing = db.get('SELECT id FROM identity_verifications WHERE user_id = ?', req.session.user.id);
      if (existing) {
        db.runStmt("UPDATE identity_verifications SET image_path = ?, status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", imagePath, req.session.user.id);
      } else {
        db.runStmt("INSERT INTO identity_verifications (user_id, image_path, status) VALUES (?, ?, 'pending')", req.session.user.id, imagePath);
      }
    }
    req.session.success_msg = '✅ تم رفع الهوية، سيقوم الإدارة بمراجعتها';
  } catch(err) {
    console.error('Upload error:', err);
    req.session.error_msg = '❌ حدث خطأ';
  }
  res.redirect('/client/settings');
});

module.exports = router;
