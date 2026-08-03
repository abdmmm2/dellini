const express = require('express');
const router = express.Router();
const { getDB } = require('../database');

// Home page
router.get('/', (req, res) => {
  const db = getDB();
  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order', );

  // Get top consultants
  const topConsultants = db.all(`
    SELECT c.*, u.name as user_name, u.avatar,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = c.id AND status = 'closed') as completed_count
    FROM consultants c
    JOIN users u ON u.id = c.user_id
    WHERE c.is_verified = 1 AND c.is_available = 1
    ORDER BY c.rating DESC
    LIMIT 6
  `);

  // Get online consultants (shows all verified, available consultants)
  // Green indicator logic: last_active within 5 min = 🟢, otherwise ⚪
  const onlineConsultants = db.all(`
    SELECT c.*, u.name as user_name, u.avatar, u.is_online, u.last_active,
      cat.name_ar as category_name, cat.icon as category_icon,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = c.id AND status = 'closed') as completed_count
    FROM consultants c
    JOIN users u ON u.id = c.user_id
    LEFT JOIN consultant_categories cc ON cc.consultant_id = c.id
    LEFT JOIN categories cat ON cat.id = cc.category_id
    WHERE c.is_verified = 1 AND c.is_available = 1
    GROUP BY c.id
    ORDER BY u.last_active DESC
    LIMIT 8
  `);

  // Stats
  const stats = {
    consultants: db.get('SELECT COUNT(*) as count FROM consultants WHERE is_verified = 1').count,
    consultations: db.get('SELECT COUNT(*) as count FROM consultations WHERE status != \'draft\'').count,
    categories: categories.length
  };

  // Get active ads
  const ads = db.all('SELECT * FROM ads WHERE is_active = 1 ORDER BY sort_order', );

  // Get services grouped by category
  const services = db.all(`
    SELECT s.*, c.name_ar as category_name 
    FROM services s 
    LEFT JOIN categories c ON c.id = s.category_id 
    WHERE s.is_active = 1 
    ORDER BY s.category_id, s.sort_order
  `);

  res.render('index', { title: 'الرئيسية', categories, topConsultants, onlineConsultants, stats, ads, services });
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { title: 'عن دلني' });
});

// How it works
router.get('/how-it-works', (req, res) => {
  res.render('how-it-works', { title: 'كيف تعمل المنصة' });
});

// Contact page
router.get('/contact', (req, res) => {
  res.render('contact', { title: 'تواصل معنا' });
});

// Contact form submission
router.post('/contact', (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  
  // Send notification to admin support email
  try {
    const { sendEmail } = require('../utils/email');
    const content = '<p style="color:#555;line-height:1.8;">تم استلام رسالة جديدة من نموذج التواصل:</p>'
      + '<div style="background:#f8f9fa;border-radius:8px;padding:15px;margin:10px 0;">'
      + '<p><strong>الاسم:</strong> ' + (name || '—') + '</p>'
      + '<p><strong>البريد:</strong> ' + (email || '—') + '</p>'
      + '<p><strong>الجوال:</strong> ' + (phone || '—') + '</p>'
      + '<p><strong>الموضوع:</strong> ' + (subject || '—') + '</p>'
      + '<hr>'
      + '<p style="white-space:pre-wrap">' + (message || '') + '</p>'
      + '</div>';
    sendEmail(process.env.CONTACT_EMAIL || 'support@dellini.net', '📩 رسالة جديدة من ' + (name || 'زائر'), content).catch(() => {});
  } catch(e) {}
  
  req.session.success_msg = 'تم استلام رسالتك شكراً لتواصلك — سنرد عليك في أقرب وقت';
  res.redirect('/contact');
});

// =====================================================================
// 🔔 Notification & Phone Flag API
// =====================================================================

// API endpoint: flag phone number from frontend
router.post('/api/flag-phone-number', (req, res) => {
  const db = getDB();
  const { text, matches } = req.body;
  const userName = req.session.user ? req.session.user.name : 'مستخدم';
  
  const admins = db.all("SELECT id FROM users WHERE role IN ('admin','supervisor')");
  admins.forEach(admin => {
    db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'warning', 0, 'phone_flag')`,
      admin.id,
      '⚠️ تنبيه: رقم جوال في الاستشارة',
      `المستخدم ${userName} حاول إضافة رقم جوال: ${matches ? matches.join(', ') : 'غير معروف'}`);
  });
  
  res.json({ success: true });
});

// API: Get new notifications for sound alerts
router.get('/messages/notifications', (req, res) => {
  const db = getDB();
  const since = parseInt(req.query.since) || (Date.now() - 60000);
  
  if (!req.session.user) {
    return res.json({ notifications: [], now: Date.now() });
  }

  const userId = req.session.user.id;
  const userRole = req.session.user.role;
  
  let notifications = [];
  
  if (userRole === 'consultant') {
    // Get unread notifications for this consultant
    notifications = db.all(`
      SELECT * FROM notifications 
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC LIMIT 10
    `, userId);
  } else if (userRole === 'admin' || userRole === 'supervisor') {
    // Get admin notifications
    notifications = db.all(`
      SELECT * FROM notifications 
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC LIMIT 10
    `, userId);
  }
  
  res.json({ notifications, now: Date.now() });
});

// Mark notification as read
router.post('/api/notifications/read', (req, res) => {
  const db = getDB();
  const { id } = req.body;
  if (id && req.session.user) {
    db.runStmt('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, req.session.user.id);
  }
  res.json({ success: true });
});

module.exports = router;
