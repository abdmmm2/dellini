const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { requireLogin, requireRole } = require('../middleware/auth');
const { sendReplyNotification } = require('../utils/email');

router.use(requireLogin);
router.use(requireRole('consultant'));

// Load consultant profile into req
router.use((req, res, next) => {
  const db = getDB();
  const consultant = db.get('SELECT * FROM consultants WHERE user_id = ?', req.session.user.id);
  if (!consultant) {
    req.session.error_msg = 'الملف الاستشاري غير مكتمل';
    return res.redirect('/logout');
  }
  req.consultant = consultant;
  req.session.user.consultant_id = consultant.id;
  next();
});

// Consultant dashboard
router.get('/', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;

  const consultations = db.all(`
    SELECT cns.*, cat.name_ar as category_name, cns.client_nickname
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    WHERE cns.consultant_id = ?
    ORDER BY 
      CASE cns.status
        WHEN 'assigned' THEN 1
        WHEN 'paid' THEN 2
        WHEN 'answered' THEN 3
        WHEN 'closed' THEN 4
        ELSE 5
      END,
      cns.created_at DESC
  `, consultantId);

  const stats = {
    total: consultations.length,
    pending: consultations.filter(c => c.status === 'assigned' || c.status === 'paid').length,
    answered: consultations.filter(c => c.status === 'answered').length,
    closed: consultations.filter(c => c.status === 'closed').length
  };

  res.render('consultant/dashboard', { title: 'لوحة المستشار', consultations, stats, consultant: req.consultant });
});

// My pricing
router.get('/pricing', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;

  const categories = db.all(`
    SELECT cat.*, cc.id as cc_id, cc.price, cc.is_active as cc_active, cc.voice_enabled, cc.voice_price_per_minute
    FROM categories cat
    LEFT JOIN consultant_categories cc ON cc.category_id = cat.id AND cc.consultant_id = ?
    WHERE cat.is_active = 1
    ORDER BY cat.sort_order
  `, consultantId);

  res.render('consultant/pricing', { title: 'أسعار الاستشارات', categories, consultant: req.consultant });
});

// Update pricing
router.post('/pricing', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;
  const { category_id, price, action, type, voice_enabled, voice_price_per_min } = req.body;

  const existing = db.get("SELECT id FROM consultant_categories WHERE consultant_id = ? AND category_id = ?", consultantId, category_id);

  if (action === 'remove' && existing) {
    db.runStmt('DELETE FROM consultant_categories WHERE id = ?', existing.id);
    req.session.success_msg = 'تم إلغاء الاشتراك في هذا القسم';
  } else if (action === 'voice_toggle') {
    const enabled = voice_enabled === '1' ? 1 : 0;
    if (existing) {
      db.runStmt("UPDATE consultant_categories SET voice_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", enabled, existing.id);
    } else {
      db.runStmt("INSERT INTO consultant_categories (consultant_id, category_id, voice_enabled) VALUES (?, ?, ?)", consultantId, category_id, enabled);
    }
    req.session.success_msg = enabled ? 'تم تفعيل المكالمات الصوتية للقسم ✅' : 'تم إلغاء تفعيل المكالمات الصوتية ❌';
  } else if (action === 'voice_price') {
    if (existing) {
      db.runStmt("UPDATE consultant_categories SET voice_price_per_minute = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        parseFloat(voice_price_per_min) || 5, existing.id);
    }
    req.session.success_msg = 'تم تحديث سعر الدقيقة الصوتية';
  } else if (existing) {
    db.runStmt("UPDATE consultant_categories SET price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", price, existing.id);
    req.session.success_msg = 'تم تحديث السعر بنجاح';
  } else {
    db.runStmt("INSERT INTO consultant_categories (consultant_id, category_id, price) VALUES (?, ?, ?)", consultantId, category_id, price);
    req.session.success_msg = 'تم إضافة القسم بنجاح';
  }

  res.redirect('/consultant/pricing');
});

// View consultation detail & reply
router.get('/consultation/:id', (req, res) => {
  const db = getDB();
  const consultation = db.get(`
    SELECT cns.*, cat.name_ar as category_name
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    WHERE cns.id = ? AND cns.consultant_id = ?
  `, req.params.id, req.consultant.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/consultant');
  }

  const messages = db.all(`
    SELECT m.*, u.name as sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.consultation_id = ?
    ORDER BY m.created_at ASC
  `, req.params.id);

  res.render('consultant/consultation-detail', { title: 'تفاصيل الاستشارة', consultation, messages });
});

// Reply to consultation
router.post('/reply/:id', (req, res) => {
  const db = getDB();
  const { message } = req.body;

  if (!message || message.trim().length < 2) {
    req.session.error_msg = 'الرجاء كتابة الرد';
    return res.redirect(`/consultant/consultation/${req.params.id}`);
  }

  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND consultant_id = ?", req.params.id, req.consultant.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/consultant');
  }

  // Insert message
  db.runStmt(`
    INSERT INTO messages (consultation_id, sender_id, sender_role, message)
    VALUES (?, ?, 'consultant', ?)
  `, consultation.id, req.session.user.id, message);

  // Update status if it's first reply
  if (consultation.status === 'assigned' || consultation.status === 'paid') {
    db.runStmt("UPDATE consultations SET status = 'answered', updated_at = CURRENT_TIMESTAMP WHERE id = ?", consultation.id);

    // Notify client
    db.runStmt(`
      INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'info', ?, 'consultation')
    `, consultation.client_id, 'تم الرد على استشارتك', 'قام المستشار بالرد على استشارتك', consultation.id);

    // Send email to client
    const client = db.get('SELECT name, email FROM users WHERE id = ?', consultation.client_id);
    if (client) {
      sendReplyNotification(client.email, client.name, consultation.id).catch(() => {});
    }
  }

  req.session.success_msg = 'تم إرسال الرد بنجاح';
  res.redirect(`/consultant/consultation/${consultation.id}`);
});

// Balance & Withdrawals
router.get('/balance', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;

  const transactions = db.all(`
    SELECT t.*, cns.title, cns.question
    FROM transactions t
    LEFT JOIN consultations cns ON cns.id = t.consultation_id
    WHERE t.type IN ('payment', 'fee') AND t.user_id = ?
    ORDER BY t.created_at DESC
  `, req.session.user.id);

  const withdrawals = db.all(`
    SELECT * FROM withdrawal_requests
    WHERE consultant_id = ?
    ORDER BY created_at DESC
  `, consultantId);

  res.render('consultant/balance', { title: 'الرصيد والأرباح', transactions, withdrawals, consultant: req.consultant });
});

// Withdrawal request
router.post('/withdraw', (req, res) => {
  const db = getDB();
  const { amount, bank_account_details } = req.body;
  const consultantId = req.consultant.id;

  const parsedAmount = parseFloat(amount);
  if (!parsedAmount || parsedAmount <= 0) {
    req.session.error_msg = 'الرجاء إدخال مبلغ صحيح';
    return res.redirect('/consultant/balance');
  }

  if (parsedAmount > req.consultant.balance) {
    req.session.error_msg = 'الرصيد غير كافٍ للسحب';
    return res.redirect('/consultant/balance');
  }

  if (parsedAmount < 100) {
    req.session.error_msg = 'الحد الأدنى للسحب هو 100 ريال';
    return res.redirect('/consultant/balance');
  }

  db.runStmt(`
    INSERT INTO withdrawal_requests (consultant_id, amount, bank_account_details, status)
    VALUES (?, ?, ?, 'pending')
  `, consultantId, parsedAmount, bank_account_details || '');

  req.session.success_msg = 'تم تقديم طلب السحب بنجاح، بانتظار موافقة الإدارة';
  res.redirect('/consultant/balance');
});

// Update profile
router.get('/profile', (req, res) => {
  const db = getDB();
  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order');
  res.render('consultant/profile', { title: 'الملف الشخصي', categories, consultant: req.consultant });
});

router.post('/profile', (req, res) => {
  const db = getDB();
  const { bio, experience_years, credentials } = req.body;

  db.runStmt(`
    UPDATE consultants SET bio = ?, experience_years = ?, credentials = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, bio || '', parseInt(experience_years) || 0, credentials || '', req.consultant.id);

  req.session.success_msg = 'تم تحديث الملف الشخصي';
  res.redirect('/consultant/profile');
});

// Toggle availability (AJAX)
router.post('/toggle-availability', (req, res) => {
  const db = getDB();
  const consultant = db.get('SELECT * FROM consultants WHERE user_id = ?', req.session.user.id);
  db.runStmt("UPDATE consultants SET is_available = CASE WHEN is_available = 1 THEN 0 ELSE 1 END WHERE id = ?", consultant.id);
  res.json({ success: true });
});

// =====================================================================
// 💡 CONSULTANT SERVICES MANAGEMENT
// =====================================================================
router.get('/services', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;
  
  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order');
  const myServices = db.all(`
    SELECT cs.*, s.name_ar, s.description, s.icon, s.category_id, c.name_ar as category_name
    FROM consultant_services cs
    JOIN services s ON s.id = cs.service_id
    LEFT JOIN categories c ON c.id = s.category_id
    WHERE cs.consultant_id = ?
    ORDER BY c.sort_order, s.sort_order
  `, consultantId);
  
  // All available services with assignment status
  const allServices = db.all(`
    SELECT s.*, c.name_ar as cat_name,
      CASE WHEN cs.id IS NOT NULL THEN 1 ELSE 0 END as is_assigned,
      cs.price, cs.is_active as cs_active
    FROM services s
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN consultant_services cs ON cs.service_id = s.id AND cs.consultant_id = ?
    WHERE s.is_active = 1
    ORDER BY c.sort_order, s.sort_order
  `, consultantId);
  
  res.render('consultant/services', { title: 'خدماتي', categories, myServices, allServices });
});

router.post('/services/toggle', (req, res) => {
  const db = getDB();
  const consultantId = req.consultant.id;
  const { service_id, action, price } = req.body;
  
  if (action === 'add') {
    db.runStmt('INSERT OR IGNORE INTO consultant_services (consultant_id, service_id, price) VALUES (?, ?, ?)',
      consultantId, service_id, price || null);
  } else if (action === 'remove') {
    db.runStmt('DELETE FROM consultant_services WHERE consultant_id = ? AND service_id = ?',
      consultantId, service_id);
  } else if (action === 'price') {
    db.runStmt('UPDATE consultant_services SET price = ? WHERE consultant_id = ? AND service_id = ?',
      price, consultantId, service_id);
  }
  
  res.json({ success: true });
});

module.exports = router;