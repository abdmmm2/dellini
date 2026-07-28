const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../database');
const { requireLogin, requireStaff, requireAdmin } = require('../middleware/auth');
const { VERIFICATION_TIERS, getTierInfo } = require('../utils/verification');

// Multer for avatar uploads
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public');
const avatarsDir = path.join(UPLOADS_DIR, 'uploads', 'avatars');
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, avatarsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'avatar_' + req.params.id + '_' + Date.now() + ext);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

router.use(requireLogin);
router.use(requireStaff);

// ─── Admin Dashboard ───
router.get('/', (req, res) => {
  const db = getDB();
  const isAdmin = req.session.user.role === 'admin';

  const stats = {
    users: db.get('SELECT COUNT(*) as c FROM users').c,
    clients: db.get("SELECT COUNT(*) as c FROM users WHERE role = 'client'").c,
    consultants: db.get("SELECT COUNT(*) as c FROM users WHERE role = 'consultant'").c,
    consultations: db.get('SELECT COUNT(*) as c FROM consultations').c,
    pendingConsultations: db.get("SELECT COUNT(*) as c FROM consultations WHERE status IN ('paid','assigned')").c,
    closedConsultations: db.get("SELECT COUNT(*) as c FROM consultations WHERE status = 'closed'").c,
    pendingWithdrawals: db.get("SELECT COUNT(*) as c FROM withdrawal_requests WHERE status = 'pending'").c,
    unverifiedConsultants: db.get("SELECT COUNT(*) as c FROM consultants WHERE is_verified = 0").c,
    totalRevenue: db.get("SELECT COALESCE(SUM(platform_fee), 0) as total FROM transactions WHERE type = 'payment' AND status = 'completed'").total,
  };

  // Recent consultations
  const recentConsultations = db.all(`
    SELECT cns.*, cat.name_ar as category_name, cl.name as client_name, conu.name as consultant_name
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    JOIN users cl ON cl.id = cns.client_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users conu ON conu.id = con.user_id
    ORDER BY cns.created_at DESC LIMIT 10
  `, );

  // Last 7 days revenue
  const weeklyRevenue = db.all(`
    SELECT DATE(created_at) as day, COALESCE(SUM(platform_fee), 0) as revenue
    FROM transactions
    WHERE type = 'payment' AND status = 'completed' AND created_at >= DATE('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY day
  `);

  res.render('admin/dashboard', {
    title: 'لوحة التحكم',
    stats,
    recentConsultations,
    weeklyRevenue,
    isAdmin
  });
});

// ─── User Management (Admin only) ───
router.get('/users', requireAdmin, (req, res) => {
  const db = getDB();
  const search = req.query.search || '';
  const role_filter = req.query.role_filter || '';

  let query = `
    SELECT u.*, con.is_verified as consultant_verified
    FROM users u
    LEFT JOIN consultants con ON con.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    query += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term, term);
  }

  if (role_filter) {
    query += ' AND u.role = ?';
    params.push(role_filter);
  }

  query += ' ORDER BY u.created_at DESC';

  const users = db.all(query, ...params);

  res.render('admin/users', { title: 'إدارة المستخدمين', users, search, role_filter });
});

router.post('/users/toggle', requireAdmin, (req, res) => {
  const db = getDB();
  const { user_id } = req.body;
  const user = db.get('SELECT * FROM users WHERE id = ?', user_id);

  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  db.runStmt("UPDATE users SET is_active = ? WHERE id = ?", user.is_active ? 0 : 1, user_id);

  req.session.success_msg = `تم ${user.is_active ? 'تعطيل' : 'تفعيل'} المستخدم`;
  res.redirect('/admin/users');
});

// ─── Categories ───
router.get('/categories', (req, res) => {
  const db = getDB();
  const categories = db.all('SELECT * FROM categories ORDER BY sort_order');
  const mainCats = categories.filter(c => !c.parent_id);
  res.render('admin/categories', { title: 'إدارة الأقسام', categories, mainCats });
});

router.post('/categories/add', requireAdmin, (req, res) => {
  const db = getDB();
  const { name_ar, description, icon, sort_order, parent_id } = req.body;

  if (!name_ar) {
    req.session.error_msg = 'اسم القسم مطلوب';
    return res.redirect('/admin/categories');
  }

  // Using db.runStmt
  db.runStmt("INSERT INTO categories (name_ar, description, icon, sort_order, parent_id) VALUES (?, ?, ?, ?, ?)", name_ar, description || "", icon || "bi-chat-dots", parseInt(sort_order) || 0, parent_id || null);

  req.session.success_msg = 'تم إضافة القسم بنجاح';
  res.redirect('/admin/categories');
});

router.post('/categories/edit', requireAdmin, (req, res) => {
  const db = getDB();
  const { id, name_ar, description, icon, sort_order, is_active } = req.body;

  db.runStmt(`
    UPDATE categories SET name_ar = ?, description = ?, icon = ?, sort_order = ?, is_active = ?, parent_id = ?
    WHERE id = ?
  `, name_ar, description || '', icon || 'bi-chat-dots', parseInt(sort_order) || 0, is_active ? 1 : 0, req.body.parent_id || null, id);

  req.session.success_msg = 'تم تحديث القسم بنجاح';
  res.redirect('/admin/categories');
});

router.post('/categories/delete', requireAdmin, (req, res) => {
  const db = getDB();
  const { id } = req.body;

  // Check if consultations exist
  const count = db.get('SELECT COUNT(*) as c FROM consultations WHERE category_id = ?', id).c;
  if (count > 0) {
    req.session.error_msg = 'لا يمكن حذف القسم، يوجد استشارات مرتبطة به';
    return res.redirect('/admin/categories');
  }

  db.runStmt('DELETE FROM categories WHERE id = ?', id);
  req.session.success_msg = 'تم حذف القسم';
  res.redirect('/admin/categories');
});

// ─── Consultants Verification ───
router.get('/consultants', (req, res) => {
  const db = getDB();
  const consultants = db.all(`
    SELECT con.*, u.name as user_name, u.email, u.phone,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = con.id) as consultations_count
    FROM consultants con
    JOIN users u ON u.id = con.user_id
    ORDER BY con.is_verified ASC, con.created_at DESC
  `);

  res.render('admin/consultants', { title: 'المستشارون', consultants });
});

router.post('/consultants/verify', requireAdmin, (req, res) => {
  const db = getDB();
  const { consultant_id, action } = req.body;

  if (action === 'approve') {
    db.runStmt('UPDATE consultants SET is_verified = 1 WHERE id = ?', consultant_id);
    // Notify consultant
    const con = db.get('SELECT user_id FROM consultants WHERE id = ?', consultant_id);
    db.runStmt(`
      INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'success', ?, 'verification')
    `, con.user_id, 'تم توثيق حسابك', 'تم الموافقة على طلب توثيق حسابك الاستشاري', consultant_id);
    req.session.success_msg = 'تم توثيق المستشار';
  } else {
    req.session.success_msg = 'تم رفض الطلب';
  }

  res.redirect('/admin/consultants');
});

// ─── All Consultations with search & filter ───
router.get('/consultations', (req, res) => {
  const db = getDB();
  const status = req.query.status || '';
  const search = req.query.search || '';

  let query = `
    SELECT cns.*, cat.name_ar as category_name, cl.name as client_name,
      conu.name as consultant_name
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    JOIN users cl ON cl.id = cns.client_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users conu ON conu.id = con.user_id
    WHERE 1=1
  `;

  const params = [];

  if (status) {
    query += ' AND cns.status = ?';
    params.push(status);
  }

  if (search) {
    query += ` AND (cns.title LIKE ? OR cns.question LIKE ? OR CAST(cns.id AS TEXT) LIKE ? OR cl.name LIKE ? OR conu.name LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }

  query += ' ORDER BY cns.created_at DESC';

  const consultations = db.all(query, ...params);
  res.render('admin/consultations', { title: 'الاستشارات', consultations, currentStatus: status, search });
});

// ─── Withdrawals ───
router.get('/withdrawals', (req, res) => {
  const db = getDB();
  const withdrawals = db.all(`
    SELECT wr.*, u.name as consultant_name, u.email, con.balance
    FROM withdrawal_requests wr
    JOIN consultants con ON con.id = wr.consultant_id
    JOIN users u ON u.id = con.user_id
    ORDER BY 
      CASE wr.status
        WHEN 'pending' THEN 1
        ELSE 2
      END,
      wr.created_at DESC
  `, );

  res.render('admin/withdrawals', { title: 'طلبات السحب', withdrawals });
});

router.post('/withdrawals/process', requireAdmin, (req, res) => {
  const db = getDB();
  const { request_id, action, admin_note } = req.body;

  const wr = db.get('SELECT * FROM withdrawal_requests WHERE id = ?', request_id);
  if (!wr || wr.status !== 'pending') {
    req.session.error_msg = 'الطلب غير موجود أو تم معالجته مسبقاً';
    return res.redirect('/admin/withdrawals');
  }

  if (action === 'approve') {
    db.runStmt(`
      UPDATE withdrawal_requests SET status = 'approved', admin_note = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, admin_note || '', req.session.user.id, request_id);

    // Deduct from consultant balance
    db.runStmt("UPDATE consultants SET balance = balance - ? WHERE id = ?", wr.amount, wr.consultant_id);

    // Record transaction
    db.runStmt(`
      INSERT INTO transactions (user_id, type, amount, status, description)
      VALUES ((SELECT user_id FROM consultants WHERE id = ?), 'withdrawal', ?, 'completed', ?)
    `, wr.consultant_id, wr.amount, 'سحب أرباح');

    req.session.success_msg = 'تمت الموافقة على طلب السحب';
  } else {
    db.runStmt(`
      UPDATE withdrawal_requests SET status = 'rejected', admin_note = ?, processed_by = ?, processed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, admin_note || '', req.session.user.id, request_id);

    req.session.success_msg = 'تم رفض طلب السحب';
  }

  res.redirect('/admin/withdrawals');
});

// ─── Financial Reports (Admin only) ───
router.get('/reports', requireAdmin, (req, res) => {
  const db = getDB();

  const period = req.query.period || 'all';
  let dateFilter = '';
  if (period === 'today') dateFilter = " AND DATE(t.created_at) = DATE('now')";
  else if (period === 'week') dateFilter = " AND t.created_at >= DATE('now', '-7 days')";
  else if (period === 'month') dateFilter = " AND t.created_at >= DATE('now', '-30 days')";
  else if (period === 'year') dateFilter = " AND t.created_at >= DATE('now', '-365 days')";

  const transactions = db.all(`
    SELECT t.*, u.name as user_name, cns.title, cns.question
    FROM transactions t
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN consultations cns ON cns.id = t.consultation_id
    WHERE t.type IN ('payment', 'fee', 'withdrawal')${dateFilter}
    ORDER BY t.created_at DESC
  `);

  const summary = db.get(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN type = 'payment' THEN platform_fee ELSE 0 END), 0) as total_fees,
      COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) as total_withdrawals,
      COUNT(CASE WHEN type = 'payment' THEN 1 END) as payment_count
    FROM transactions t
    WHERE t.status = 'completed'${dateFilter}
  `) || { total_revenue: 0, total_fees: 0, total_withdrawals: 0, payment_count: 0 };

  res.render('admin/reports', { title: 'التقارير المالية', transactions, summary, period });
});

// =====================================================================
// 📄 EXPORT REPORTS TO PDF
// =====================================================================
router.get('/reports/export-pdf', requireAdmin, (req, res) => {
  const db = getDB();
  const PDFDocument = require('pdfkit');

  const period = req.query.period || 'all';
  let dateFilter = '';
  let periodLabel = 'كل الفترات';
  if (period === 'today') { dateFilter = " AND DATE(t.created_at) = DATE('now')"; periodLabel = 'اليوم'; }
  else if (period === 'week') { dateFilter = " AND t.created_at >= DATE('now', '-7 days')"; periodLabel = 'آخر 7 أيام'; }
  else if (period === 'month') { dateFilter = " AND t.created_at >= DATE('now', '-30 days')"; periodLabel = 'آخر 30 يوم'; }
  else if (period === 'year') { dateFilter = " AND t.created_at >= DATE('now', '-365 days')"; periodLabel = 'آخر سنة'; }

  const allTrans = db.all(`SELECT t.*, u.name as user_name FROM transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.type IN ('payment','fee','withdrawal')${dateFilter} ORDER BY t.created_at DESC`);
  const withdrawals = db.all(`SELECT t.*, u.name as user_name FROM transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.type='withdrawal'${dateFilter.replace(/t\./g,'t.')} ORDER BY t.created_at DESC`);
  const consultations = db.all(`SELECT cns.*, cat.name_ar as category_name, cl.name as client_name, cns.client_nickname, conu.name as consultant_name FROM consultations cns LEFT JOIN categories cat ON cat.id=cns.category_id LEFT JOIN users cl ON cl.id=cns.client_id LEFT JOIN consultants con ON con.id=cns.consultant_id LEFT JOIN users conu ON conu.id=con.user_id ORDER BY cns.created_at DESC`);
  const summary = db.get(`SELECT COALESCE(SUM(CASE WHEN type='payment' THEN amount ELSE 0 END),0) as total_revenue, COALESCE(SUM(CASE WHEN type='payment' THEN platform_fee ELSE 0 END),0) as total_fees, COALESCE(SUM(CASE WHEN type='withdrawal' THEN amount ELSE 0 END),0) as total_withdrawals FROM transactions t WHERE t.status='completed'${dateFilter}`) || { total_revenue:0, total_fees:0, total_withdrawals:0 };

  const doc = new PDFDocument({ size:'A4', margin:40, info:{ Title:'التقرير المالي - دلني', Author:'دلني للاستشارات', Subject:'التقرير المالي' } });

  const reportNum = 'DLN-RPT-' + Date.now().toString(36).toUpperCase();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="Delni-Report-${period}-${Date.now()}.pdf"`);
  doc.pipe(res);

  const logoPath = path.join(__dirname, '..', 'public', 'images', 'logo.png');
  const navy = '#1a2332', gold = '#c8a45c', red = '#cc0000', gray = '#6c757d', lightGray = '#f5f5f5';

  const today = new Date();
  const day = String(today.getDate()).padStart(2,'0');
  const month = String(today.getMonth()+1).padStart(2,'0');
  const year = today.getFullYear();
  const dateStr = `${day}/${month}/${year}`;

  // ================================================================
  //  🔴 STAMP - مستطيل (أبيض شفاف + أحمر) يوضع تحت آخر سطر محتوى
  // ================================================================
  function drawStamp(d, x, y) {
    const sw = 95, sh = 68; // stamp width & height
    const cx = x + sw/2, cy = y + sh/2;

    d.save();

    // خلفية بيضاء شفافة (تخفي الكتابة خفيف ولا تغطيها بالكامل)
    d.rect(x, y, sw, sh).fillOpacity(0.25).fillColor('#ffffff').fill();

    // إطار أحمر خارجي
    d.rect(x, y, sw, sh).lineWidth(2).strokeColor(red).stroke();
    // إطار داخلي أحمر رفيع
    d.rect(x+3, y+3, sw-6, sh-6).lineWidth(0.8).strokeColor(red).stroke();

    // رقم التقرير في الأعلى
    d.fontSize(6).fillColor(red);
    d.text(reportNum, x, y + 5, { width: sw, align: 'center' });

    // الشعار في النصف
    try {
      if (fs.existsSync(logoPath)) {
        d.image(logoPath, cx-14, cy-10, { width:28, height:28 });
      } else {
        d.fontSize(16).fillColor(red).text('☰', cx-6, cy-8);
      }
    } catch(_) {
      d.fontSize(16).fillColor(red).text('◉', cx-6, cy-8);
    }

    // تاريخ الإصدار في الأسفل
    d.fontSize(5.5).fillColor(red);
    d.text(dateStr, x, y + sh - 14, { width: sw, align: 'center' });

    // نقاط زينة حول المستطيل
    d.fillColor(red);
    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      // نقط خارج الإطار على محيط بيضوي لتتناسب مع المستطيل
      const dx = x + sw/2 + Math.cos(angle) * (sw/2 + 3);
      const dy = y + sh/2 + Math.sin(angle) * (sh/2 + 3);
      d.circle(dx, dy, 0.7).fill();
    }

    d.restore();
  }

  // ================================================================
  //  🖊️  المحتوى
  // ================================================================
  let y = 25;
  const pw = doc.page.width;

  // ─── الهيدر: الشعار ثم "منصة دلني للاستشارات" في اليمين ───
  try {
    if (fs.existsSync(logoPath)) doc.image(logoPath, pw - 170, y - 6, { width: 28, height: 28 });
  } catch(_) {}
  doc.fontSize(12).fillColor(navy).text('منصة دلني للاستشارات', pw - 138, y, { align: 'right' });

  // رقم التقرير والتاريخ في اليمين تحت الهيدر
  y += 22;
  doc.fontSize(8).fillColor(gray).text(`رقم التقرير: ${reportNum}`, 40, y, { align: 'right' });
  y += 12;
  doc.fontSize(8).fillColor(gray).text(`تاريخ التقرير: ${dateStr}`, 40, y, { align: 'right' });
  y += 12;
  doc.fontSize(8).fillColor(gray).text(`الفترة: ${periodLabel}`, 40, y, { align: 'right' });

  // خط فاصل
  y += 6;
  doc.moveTo(40, y).lineTo(pw - 40, y).strokeColor(navy).lineWidth(0.8).stroke();
  y += 12;

  // ─── ملخص ───
  doc.fontSize(11).fillColor(navy).text('ملخص', 40, y, { align: 'right' });
  y += 16;

  const cards = [
    { label:'إجمالي الإيرادات', val:`${summary.total_revenue} ر.س`, c:'#198754' },
    { label:'عمولات المنصة',    val:`${summary.total_fees} ر.س`, c:navy },
    { label:'إجمالي المسحوبات', val:`${summary.total_withdrawals} ر.س`, c:'#dc3545' },
    { label:'الصافي',           val:`${summary.total_revenue - summary.total_withdrawals} ر.س`, c:'#0d6efd' }
  ];
  cards.forEach((cr, i) => {
    const cx = i % 2 === 0 ? 40 : pw / 2 + 5;
    const cy = y + Math.floor(i/2) * 30;
    const cw = pw / 2 - 45;
    doc.rect(cx, cy, cw, 26).fillColor('#f8f9fa').fill()
       .rect(cx, cy, cw, 26).lineWidth(0.3).strokeColor('#dee2e6').stroke();
    doc.rect(cx, cy, 3, 26).fillColor(cr.c).fill();
    doc.fontSize(8).fillColor(gray).text(cr.label, cx + 8, cy + 3, { width:cw-12, align:'right' });
    doc.fontSize(11).fillColor(cr.c).text(cr.val, cx + 8, cy + 12, { width:cw-12, align:'right' });
  });
  y += 64;

  // ─── المسحوبات ───
  if (withdrawals.length > 0) {
    doc.fontSize(11).fillColor('#dc3545').text('المسحوبات', 40, y, { align:'right' });
    y += 16;
    doc.rect(40, y, pw-80, 15).fillColor('#dc3545');
    doc.fontSize(7).fillColor('#fff');
    doc.text('#', 45, y+3, { width:25, align:'right' });
    doc.text('المستخدم', 75, y+3, { width:100, align:'right' });
    doc.text('المبلغ', pw-175, y+3, { width:60, align:'left' });
    doc.text('التاريخ', pw-110, y+3, { width:70, align:'left' });
    y += 15;
    let wsum = 0;
    withdrawals.forEach((w,i) => {
      if (i%2===0) doc.rect(40, y, pw-80, 15).fillColor('#fff5f5').fill();
      doc.fontSize(7).fillColor('#333');
      doc.text(`#${i+1}`, 45, y+2, { width:25, align:'right' });
      doc.text(w.user_name||'—', 75, y+2, { width:100, align:'right' });
      doc.fontSize(8).fillColor('#dc3545').text(`${w.amount} ر.س`, pw-175, y+2, { width:60, align:'left' });
      doc.fontSize(6).fillColor(gray).text(w.created_at?new Date(w.created_at).toLocaleDateString('en-GB'):'—', pw-110, y+2, { width:70, align:'left' });
      wsum += w.amount||0;
      y += 15;
      if (y > doc.page.height-90) { doc.addPage(); y = 30; }
    });
    y += 2;
    doc.moveTo(40, y).lineTo(pw-40, y).strokeColor('#dc3545').lineWidth(0.3).stroke();
    y += 4;
    doc.fontSize(9).fillColor('#dc3545').text(`إجمالي المسحوبات: ${wsum} ر.س`, 40, y, { align:'right' });
    y += 16;
  }

  // ─── الاستشارات ───
  const paidCons = consultations.filter(c => ['paid','assigned','answered','closed'].includes(c.status) || c.payment_status==='paid');
  if (paidCons.length > 0) {
    if (y > doc.page.height-120) { doc.addPage(); y=30; }
    doc.fontSize(11).fillColor(navy).text('الاستشارات', 40, y, { align:'right' });
    y += 16;
    doc.rect(40, y, pw-80, 15).fillColor(navy);
    doc.fontSize(7).fillColor('#fff');
    doc.text('#', 44, y+3, { width:25, align:'right' });
    doc.text('العميل', 70, y+3, { width:80, align:'right' });
    doc.text('المستشار', 150, y+3, { width:80, align:'right' });
    doc.text('المبلغ', pw-110, y+3, { width:70, align:'left' });
    y += 15;
    let csum = 0;
    paidCons.forEach((c,i) => {
      if (i%2===0) doc.rect(40, y, pw-80, 14).fillColor(lightGray).fill();
      doc.fontSize(7).fillColor('#333');
      doc.text(`#${c.id}`, 44, y+2, { width:25, align:'right' });
      doc.text(c.client_nickname||c.client_name||'—', 70, y+2, { width:80, align:'right' });
      doc.text(c.consultant_name||'—', 150, y+2, { width:80, align:'right' });
      doc.fontSize(8).fillColor('#198754').text(`${c.amount||0} ر.س`, pw-110, y+2, { width:70, align:'left' });
      csum += c.amount||0;
      y += 14;
      if (y > doc.page.height-90) { doc.addPage(); y=30; }
    });
    y += 2;
    doc.moveTo(40, y).lineTo(pw-40, y).strokeColor(navy).lineWidth(0.3).stroke();
    y += 4;
    doc.fontSize(9).fillColor(navy).text(`إجمالي الاستشارات: ${csum} ر.س (${paidCons.length})`, 40, y, { align:'right' });
    y += 16;
  }

  // ─── جميع المعاملات ───
  if (allTrans.length > 0) {
    if (y > doc.page.height-100) { doc.addPage(); y=30; }
    doc.fontSize(11).fillColor(navy).text('جميع المعاملات', 40, y, { align:'right' });
    y += 16;
    doc.rect(40, y, pw-80, 15).fillColor(navy);
    doc.fontSize(7).fillColor('#fff');
    doc.text('#', 44, y+3, { width:20, align:'right' });
    doc.text('المستخدم', 66, y+3, { width:70, align:'right' });
    doc.text('النوع', 140, y+3, { width:35, align:'right' });
    doc.text('المبلغ', pw-205, y+3, { width:50, align:'left' });
    doc.text('العمولة', pw-150, y+3, { width:40, align:'left' });
    doc.text('التاريخ', pw-105, y+3, { width:65, align:'left' });
    y += 15;

    const maxRows = Math.min(allTrans.length, 30);
    let r = 0;
    allTrans.slice(0, maxRows).forEach(t => {
      if (y > doc.page.height-55) { doc.addPage(); y=30; r=0; }
      if (r%2===0) doc.rect(40, y, pw-80, 14).fillColor(lightGray).fill();
      const tl = t.type==='payment'?'دفع':t.type==='withdrawal'?'سحب':'رسوم';
      const tc = t.type==='payment'?'#198754':t.type==='withdrawal'?'#dc3545':'#0dcaf0';
      doc.fontSize(7).fillColor('#333');
      doc.text(`#${t.id}`, 44, y+2, { width:20, align:'right' });
      doc.text(t.user_name||'—', 66, y+2, { width:70, align:'right' });
      doc.fontSize(6).fillColor(tc).text(tl, 140, y+2, { width:35, align:'right' });
      doc.fontSize(7).fillColor('#333').text(`${t.amount}`, pw-205, y+2, { width:50, align:'left' });
      doc.fontSize(7).fillColor(gray).text(`${t.platform_fee||0}`, pw-150, y+2, { width:40, align:'left' });
      doc.fontSize(6).fillColor(gray).text(t.created_at?new Date(t.created_at).toLocaleDateString('en-GB'):'', pw-105, y+2, { width:65, align:'left' });
      y += 14; r++;
    });
    y += 6;
  }

  // ================================================================
  //  🖨️  الختم مباشرة تحت المجموع النهائي
  // ================================================================
  y += 6;
  // الختم في منتصف الصفحة تحت آخر محتوى
  drawStamp(doc, pw/2 - 48, y);

  // ================================================================
  //  📝  تذييل
  // ================================================================
  y += 85;
  doc.moveTo(40, y).lineTo(pw-40, y).strokeColor('#dee2e6').lineWidth(0.3).stroke();
  y += 4;
  doc.fontSize(7).fillColor(gray).text(`منصة دلني للاستشارات - ${dateStr} - ${reportNum}`, 40, y, { align:'center', width:pw-80 });

  doc.end();
});

// ─── Site Settings ───
router.get('/settings', requireAdmin, (req, res) => {
  res.render('admin/settings', { title: 'الإعدادات' });
});

// =====================================================================
// 🖊️ EDIT CONSULTATION
// =====================================================================
router.get('/consultation/edit/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const consultation = db.get(`
    SELECT cns.*, cat.name_ar as category_name, cl.name as client_name, cl.email as client_email,
      conu.name as consultant_name
    FROM consultations cns
    JOIN categories cat ON cat.id = cns.category_id
    JOIN users cl ON cl.id = cns.client_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users conu ON conu.id = con.user_id
    WHERE cns.id = ?
  `, req.params.id);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/admin/consultations');
  }

  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order');
  const consultants = db.all(`
    SELECT con.*, u.name FROM consultants con JOIN users u ON u.id = con.user_id WHERE con.is_verified = 1
  `);

  res.render('admin/edit-consultation', { title: 'تعديل الاستشارة', consultation, categories, consultants });
});

router.post('/consultation/edit/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const { consultant_id, category_id, status, amount, title, question, admin_note } = req.body;

  db.runStmt(`
    UPDATE consultations SET
      consultant_id = ?, category_id = ?, status = ?, amount = ?,
      title = ?, question = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, consultant_id || null, category_id, status, parseFloat(amount) || 0,
    title || '', question || '', req.params.id);

  // Log admin action
  console.log(`📝 Admin ${req.session.user.id} edited consultation #${req.params.id}`);

  req.session.success_msg = 'تم تعديل الاستشارة بنجاح';
  res.redirect('/admin/consultations');
});

// =====================================================================
// 👤 EDIT USER (including WhatsApp & verification)
// =====================================================================
router.get('/user/edit/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  let consultant = null;
  let walletTransactions = [];
  if (user.role === 'consultant') {
    consultant = db.get('SELECT * FROM consultants WHERE user_id = ?', user.id);
  }

  // Get wallet transactions
  const wallet = db.get('SELECT id FROM wallets WHERE user_id = ?', user.id);
  if (wallet) {
    walletTransactions = db.all('SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 10', wallet.id);
  }

  res.render('admin/edit-user', { title: 'تعديل المستخدم', user, consultant, verificationTiers: VERIFICATION_TIERS, walletTransactions });
});

router.post('/user/edit/:id', requireAdmin, uploadAvatar.single('avatar'), (req, res) => {
  const db = getDB();
  const bcrypt = require('bcryptjs');
  const { name, email, phone, whatsapp, role, is_active, password, confirm_password, add_balance } = req.body;

  // Update basic info
  db.runStmt(`
    UPDATE users SET name = ?, email = ?, phone = ?, whatsapp = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, name, email, phone || null, whatsapp || null, role, is_active ? 1 : 0, req.params.id);

  // Handle password change
  if (password && password.length >= 6 && password === confirm_password) {
    const hashed = bcrypt.hashSync(password, 10);
    db.runStmt('UPDATE users SET password = ? WHERE id = ?', hashed, req.params.id);
    req.session.success_msg = 'تم تعديل الحساب وتحديث كلمة المرور';
  }

  // Handle avatar upload
  if (req.file) {
    const avatarPath = '/uploads/avatars/' + req.file.filename;
    db.runStmt('UPDATE users SET avatar = ? WHERE id = ?', avatarPath, req.params.id);
  }

  // Handle wallet balance addition
  if (add_balance && parseFloat(add_balance) > 0) {
    const amount = parseFloat(add_balance);
    const user = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
    
    if (user.role === 'consultant') {
      db.runStmt('UPDATE consultants SET balance = COALESCE(balance, 0) + ? WHERE user_id = ?', amount, req.params.id);
    } else {
      // For clients and others, use wallet_balance
      db.runStmt('UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?', amount, req.params.id);
      
      // Ensure wallet record exists
      let wallet = db.get('SELECT id FROM wallets WHERE user_id = ?', req.params.id);
      if (!wallet) {
        db.runStmt('INSERT INTO wallets (user_id, balance) VALUES (?, ?)', req.params.id, amount);
        wallet = db.get('SELECT id FROM wallets WHERE user_id = ?', req.params.id);
      } else {
        db.runStmt('UPDATE wallets SET balance = COALESCE(balance, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?', amount, req.params.id);
      }
      // Record transaction
      db.runStmt('INSERT INTO wallet_transactions (wallet_id, type, amount, description, payment_method) VALUES (?, ?, ?, ?, ?)',
        wallet.id, 'deposit', amount, 'شحن عن طريق الإدارة', 'admin');
    }
    req.session.success_msg = req.session.success_msg ? req.session.success_msg + '، تم إضافة ' + amount + ' ريال للمحفظة' : 'تم إضافة ' + amount + ' ريال للمحفظة';
  }

  // Check password validation
  if (password && password !== confirm_password) {
    req.session.error_msg = 'كلمة المرور غير متطابقة';
    return res.redirect('/admin/user/edit/' + req.params.id);
  }

  // Update consultant verification tier if applicable
  const updatedUser = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (updatedUser.role === 'consultant') {
    const { verification_tier, bio, experience_years, credentials, is_verified } = req.body;
    db.runStmt(`
      UPDATE consultants SET
        verification_tier = ?, bio = ?, experience_years = ?, credentials = ?, is_verified = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, verification_tier || 'none', bio || '', parseInt(experience_years) || 0,
      credentials || '', is_verified ? 1 : 0, req.params.id);
  }

  if (!req.session.success_msg) {
    req.session.success_msg = 'تم تعديل الحساب بنجاح';
  }
  res.redirect('/admin/users');
});

// =====================================================================
// ✅ VERIFICATION DASHBOARD
// =====================================================================
router.get('/verification', (req, res) => {
  const db = getDB();

  // All verified consultants grouped by tier
  const verified = db.all(`
    SELECT con.*, u.name as user_name, u.email, u.avatar,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = con.id AND status = 'closed') as completed_count
    FROM consultants con
    JOIN users u ON u.id = con.user_id
    WHERE con.verification_tier != 'none'
    ORDER BY 
      CASE con.verification_tier
        WHEN 'platinum' THEN 1
        WHEN 'gold' THEN 2
        WHEN 'silver' THEN 3
        WHEN 'blue' THEN 4
        WHEN 'black' THEN 5
        ELSE 6
      END
  `);

  // Stats per tier
  const tierStats = {};
  VERIFICATION_TIERS.filter(t => t.id !== 'none').forEach(t => {
    tierStats[t.id] = verified.filter(c => c.verification_tier === t.id).length;
  });

  res.render('admin/verification', { title: 'لوحة التوثيق', verified, tiers: VERIFICATION_TIERS.filter(t => t.id !== 'none'), tierStats });
});

// Public verification page
router.get('/verification/public', (req, res) => {
  const db = getDB();

  const verified = db.all(`
    SELECT con.*, u.name as user_name, u.avatar,
      cat.name_ar as category_name,
      (SELECT COUNT(*) FROM consultations WHERE consultant_id = con.id AND status = 'closed') as completed_count
    FROM consultants con
    JOIN users u ON u.id = con.user_id
    LEFT JOIN consultant_categories cc ON cc.consultant_id = con.id
    LEFT JOIN categories cat ON cat.id = cc.category_id
    WHERE con.verification_tier != 'none'
    GROUP BY con.id
    ORDER BY 
      CASE con.verification_tier
        WHEN 'platinum' THEN 1
        WHEN 'gold' THEN 2
        WHEN 'silver' THEN 3
        WHEN 'blue' THEN 4
        WHEN 'black' THEN 5
        ELSE 6
      END
  `);

  res.render('verification-public', { title: 'المستشارون الموثّقون', verified, tiers: VERIFICATION_TIERS.filter(t => t.id !== 'none') });
});

// Badge preview AJAX
router.get('/verification/badge-preview', (req, res) => {
  const { tier } = req.query;
  res.render('admin/badge-preview', { tier, layout: false });
});

// =====================================================================
// 💬 WHATSAPP INTEGRATION
// =====================================================================
router.get('/whatsapp/:userId', requireAdmin, (req, res) => {
  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE id = ?', req.params.userId);
  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  // Find consultations for this user
  let consultations = [];
  let contactPhone = user.whatsapp || user.phone;

  if (user.role === 'client') {
    consultations = db.all(`
      SELECT cns.*, cat.name_ar as category_name, conu.name as consultant_name
      FROM consultations cns
      JOIN categories cat ON cat.id = cns.category_id
      LEFT JOIN consultants con ON con.id = cns.consultant_id
      LEFT JOIN users conu ON conu.id = con.user_id
      WHERE cns.client_id = ?
      ORDER BY cns.created_at DESC LIMIT 10
    `, user.id);
  } else if (user.role === 'consultant') {
    const con = db.get('SELECT id FROM consultants WHERE user_id = ?', user.id);
    if (con) {
      consultations = db.all(`
        SELECT cns.*, cat.name_ar as category_name, cl.name as client_name
        FROM consultations cns
        JOIN categories cat ON cat.id = cns.category_id
        JOIN users cl ON cl.id = cns.client_id
        WHERE cns.consultant_id = ?
        ORDER BY cns.created_at DESC LIMIT 10
      `, con.id);
    }
  }

  res.render('admin/whatsapp', { title: 'واتساب', user, contactPhone, consultations });
});

// =====================================================================
// 📊 MASS WHATSAPP
// =====================================================================
router.get('/whatsapp-bulk', requireAdmin, (req, res) => {
  const db = getDB();
  const users = db.all("SELECT id, name, email, phone, whatsapp, role FROM users WHERE is_active = 1 ORDER BY role, name");
  res.render('admin/whatsapp-bulk', { title: 'واتساب جماعي', users });
});

// =====================================================================
// 🔄 QUICK ROLE CHANGE
// =====================================================================
router.post('/users/role', requireAdmin, (req, res) => {
  const db = getDB();
  const { user_id, role } = req.body;

  const validRoles = ['client', 'consultant', 'supervisor', 'admin'];
  if (!validRoles.includes(role)) {
    req.session.error_msg = 'دور غير صالح';
    return res.redirect('/admin/users');
  }

  const user = db.get('SELECT * FROM users WHERE id = ?', user_id);
  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  db.runStmt("UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", role, user_id);

  // If changing TO consultant, ensure consultant profile exists
  if (role === 'consultant') {
    const con = db.get('SELECT id FROM consultants WHERE user_id = ?', user_id);
    if (!con) {
      db.runStmt('INSERT INTO consultants (user_id, bio) VALUES (?, ?)', user_id, '');
    }
  }

  req.session.success_msg = `تم تغيير دور المستخدم ${user.name} إلى ${role === 'admin' ? 'مدير' : role === 'supervisor' ? 'مشرف' : role === 'consultant' ? 'مستشار' : 'عميل'}`;
  res.redirect('/admin/users');
});

// =====================================================================
// 🔗 CONSULTANT-CATEGORY LINKING
// =====================================================================
router.get('/consultant-categories', requireAdmin, (req, res) => {
  const db = getDB();

  // All consultants
  const consultants = db.all(`
    SELECT con.*, u.name as user_name, u.email
    FROM consultants con
    JOIN users u ON u.id = con.user_id
    ORDER BY u.name
  `);

  // All categories (including subcategories)
  const categories = db.all(`
    SELECT cat.*, parent.name_ar as parent_name
    FROM categories cat
    LEFT JOIN categories parent ON parent.id = cat.parent_id
    ORDER BY parent.sort_order, cat.sort_order
  `);

  // All existing links
  const links = db.all(`
    SELECT cc.*, u.name as consultant_name, cat.name_ar as category_name
    FROM consultant_categories cc
    JOIN consultants con ON con.id = cc.consultant_id
    JOIN users u ON u.id = con.user_id
    JOIN categories cat ON cat.id = cc.category_id
    ORDER BY u.name, cat.name_ar
  `);

  res.render('admin/consultant-categories', {
    title: 'ربط المستشارين بالأقسام',
    consultants,
    categories,
    links
  });
});

router.post('/consultant-categories/add', requireAdmin, (req, res) => {
  const db = getDB();
  const { consultant_id, category_id, price } = req.body;

  if (!consultant_id || !category_id) {
    req.session.error_msg = 'يرجى اختيار مستشار وقسم';
    return res.redirect('/admin/consultant-categories');
  }

  // Check if link already exists
  const existing = db.get('SELECT id FROM consultant_categories WHERE consultant_id = ? AND category_id = ?',
    consultant_id, category_id);
  if (existing) {
    db.runStmt('UPDATE consultant_categories SET price = ? WHERE id = ?',
      parseFloat(price) || 0, existing.id);
    req.session.success_msg = 'تم تحديث السعر';
  } else {
    db.runStmt('INSERT INTO consultant_categories (consultant_id, category_id, price) VALUES (?, ?, ?)',
      consultant_id, category_id, parseFloat(price) || 0);
    req.session.success_msg = 'تم ربط المستشار بالقسم';
  }

  res.redirect('/admin/consultant-categories');
});

router.post('/consultant-categories/remove', requireAdmin, (req, res) => {
  const db = getDB();
  const { id } = req.body;
  db.runStmt('DELETE FROM consultant_categories WHERE id = ?', id);
  req.session.success_msg = 'تم إلغاء الربط';
  res.redirect('/admin/consultant-categories');
});

// =====================================================================
// 💰 WALLET MANAGEMENT
// =====================================================================
router.get('/wallet/:userId', requireAdmin, (req, res) => {
  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE id = ?', req.params.userId);
  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  let wallet = db.get('SELECT * FROM wallets WHERE user_id = ?', user.id);
  if (!wallet) {
    db.runStmt('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', user.id);
    wallet = db.get('SELECT * FROM wallets WHERE user_id = ?', user.id);
  }

  const transactions = db.all('SELECT * FROM wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC', wallet.id);

  res.render('admin/wallet', { title: 'محفظة ' + user.name, user, wallet, transactions });
});

// Charge wallet (STC Pay / Apple Pay)
router.post('/wallet/charge/:userId', requireAdmin, (req, res) => {
  const db = getDB();
  const { amount, payment_method } = req.body;
  const chargeAmount = parseFloat(amount);

  if (!chargeAmount || chargeAmount < 100) {
    req.session.error_msg = 'الحد الأدنى للشحن 100 ريال';
    return res.redirect('/admin/wallet/' + req.params.userId);
  }

  const user = db.get('SELECT * FROM users WHERE id = ?', req.params.userId);
  if (!user) {
    req.session.error_msg = 'المستخدم غير موجود';
    return res.redirect('/admin/users');
  }

  let wallet = db.get('SELECT * FROM wallets WHERE user_id = ?', user.id);
  if (!wallet) {
    db.runStmt('INSERT INTO wallets (user_id, balance) VALUES (?, 0)', user.id);
    wallet = db.get('SELECT * FROM wallets WHERE user_id = ?', user.id);
  }

  // Update wallet balance
  db.runStmt('UPDATE wallets SET balance = COALESCE(balance, 0) + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    chargeAmount, wallet.id);
  db.runStmt('UPDATE users SET wallet_balance = COALESCE(wallet_balance, 0) + ? WHERE id = ?',
    chargeAmount, user.id);

  // Record transaction
  const method = payment_method || 'admin';
  db.runStmt(`INSERT INTO wallet_transactions (wallet_id, type, amount, payment_method, description, status)
    VALUES (?, 'deposit', ?, ?, ?, 'completed')`,
    wallet.id, chargeAmount, method,
    method === 'admin' ? 'شحن عن طريق الإدارة' :
    method === 'stcpay' ? 'شحن عبر STC Pay' :
    method === 'applepay' ? 'شحن عبر Apple Pay' : 'شحن محفظة');

  req.session.success_msg = `تم شحن ${chargeAmount} ريال في محفظة ${user.name}`;
  res.redirect('/admin/wallet/' + req.params.userId);
});

// =====================================================================
// ⚙️ PAYMENT SETTINGS
// =====================================================================
router.get('/payment-settings', requireAdmin, (req, res) => {
  const db = getDB();

  // Get all payment settings
  const settings = {};
  const rows = db.all('SELECT * FROM payment_settings');
  rows.forEach(r => { settings[r.key] = r.value; });

  res.render('admin/payment-settings', { title: 'إعدادات الدفع', settings });
});

router.post('/payment-settings', requireAdmin, (req, res) => {
  const db = getDB();

  // Checkboxes that are unchecked won't be in req.body, so detect them
  const gateways = ['stripe_enabled', 'stcpay_enabled', 'bank_transfer_enabled', 'applepay_enabled', 'simulate_enabled', 'voice_calls_enabled'];
  gateways.forEach(g => {
    if (!(g in req.body)) req.body[g] = '0';
  });

  const { stcpay_merchant_id, stcpay_api_key, stcpay_secret_key, stcpay_mode,
    stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, stripe_mode,
    applepay_merchant_id, applepay_domain, min_wallet_charge, platform_fee_percent,
    bank_name, bank_account_name, bank_iban, bank_account_number, bank_swift, bank_transfer_enabled, bank_transfer_wait_days,
    stripe_enabled, stcpay_enabled, applepay_enabled, simulate_enabled,
    voice_calls_enabled, voice_default_price_per_min, voice_min_duration, voice_max_duration,
    voice_default_duration, voice_provider, voice_app_id } = req.body;

  const updates = {
    stcpay_merchant_id, stcpay_api_key, stcpay_secret_key, stcpay_mode,
    stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, stripe_mode,
    applepay_merchant_id, applepay_domain, min_wallet_charge, platform_fee_percent,
    bank_name, bank_account_name, bank_iban, bank_account_number, bank_swift,
    bank_transfer_enabled, bank_transfer_wait_days,
    stripe_enabled, stcpay_enabled, applepay_enabled, simulate_enabled,
    voice_calls_enabled, voice_default_price_per_min, voice_min_duration, voice_max_duration,
    voice_default_duration, voice_provider, voice_app_id
  };

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      const existing = db.get('SELECT id FROM payment_settings WHERE key = ?', key);
      if (existing) {
        db.runStmt("UPDATE payment_settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?", String(value), key);
      } else {
        db.runStmt("INSERT INTO payment_settings (key, value) VALUES (?, ?)", key, String(value));
      }
    }
  });

  req.session.success_msg = 'تم حفظ إعدادات الدفع';
  res.redirect('/admin/payment-settings');
});

// =====================================================================
// 🏦 BANK TRANSFERS MANAGEMENT
// =====================================================================
router.get('/bank-transfers', requireAdmin, (req, res) => {
  const db = getDB();
  const transfers = db.all(`
    SELECT bt.*, u.name as client_name, cns.amount
    FROM bank_transfers bt
    LEFT JOIN users u ON u.id = bt.user_id
    LEFT JOIN consultations cns ON cns.id = bt.consultation_id
    ORDER BY bt.created_at DESC
  `);
  
  // Parse OCR data and add verified by name
  transfers.forEach(t => {
    if (t.verified_by) {
      const v = db.get('SELECT name FROM users WHERE id = ?', t.verified_by);
      t.verified_by_name = v ? v.name : '';
    }
    if (t.ocr_data && typeof t.ocr_data === 'string') {
      try { t.ocr_data = JSON.parse(t.ocr_data); } catch(e) {}
    }
  });
  
  res.render('admin/bank-transfers', { title: 'التحويلات البنكية', transfers });
});

router.post('/bank-transfer/verify', requireAdmin, (req, res) => {
  const db = getDB();
  const { transfer_id, consultation_id, status } = req.body;

  // Update bank transfer
  db.runStmt(`
    UPDATE bank_transfers SET status = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, status, req.session.user.id, transfer_id);

  // Update consultation to paid
  db.runStmt(`
    UPDATE consultations SET 
      payment_status = 'paid',
      status = 'assigned',
      payment_id = 'BANK-' || ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, transfer_id, consultation_id);

  // Get consultation for earnings
  const consultation = db.get('SELECT * FROM consultations WHERE id = ?', consultation_id);
  if (consultation && consultation.consultant_id) {
    db.runStmt('UPDATE consultants SET balance = balance + ? WHERE id = ?',
      consultation.consultant_earnings, consultation.consultant_id);

    // Notify consultant
    db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES ((SELECT user_id FROM consultants WHERE id = ?), ?, ?, 'success', ?, 'payment')`,
      consultation.consultant_id,
      '💰 تم تأكيد الدفع', 
      'تم تأكيد الدفع عبر التحويل البنكي للاستشارة #' + consultation_id,
      consultation_id);
  }

  // Notify client
  db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
    VALUES (?, ?, ?, 'success', ?, 'payment')`,
    consultation.client_id,
    '✅ تم تأكيد تحويلك البنكي',
    'تمت الموافقة على التحويل البنكي للاستشارة #' + consultation_id,
    consultation_id);

  res.json({ success: true });
});

router.post('/bank-transfer/reject', requireAdmin, (req, res) => {
  const db = getDB();
  const { transfer_id, admin_note } = req.body;

  db.runStmt(`
    UPDATE bank_transfers SET status = 'rejected', admin_note = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `, admin_note, req.session.user.id, transfer_id);

  const transfer = db.get('SELECT * FROM bank_transfers WHERE id = ?', transfer_id);
  
  // Notify client
  if (transfer) {
    db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'danger', ?, 'payment')`,
      transfer.user_id,
      '❌ لم يتم قبول التحويل البنكي',
      'السبب: ' + admin_note,
      transfer.consultation_id);
  }

  req.session.error_msg = 'تم رفض التحويل البنكي';
  res.redirect('/admin/bank-transfers');
});

// =====================================================================
// 🔐 CONSULTANT VERIFICATION FROM CONSULTANT PAGE
// =====================================================================
router.post('/consultants/verify', requireAdmin, (req, res) => {
  const db = getDB();
  const { consultant_id, action, verification_tier } = req.body;

  const consultant = db.get('SELECT * FROM consultants WHERE id = ?', consultant_id);
  if (!consultant) {
    req.session.error_msg = 'المستشار غير موجود';
    return res.redirect('/admin/consultants');
  }

  if (action === 'approve') {
    db.runStmt('UPDATE consultants SET is_verified = 1, verification_tier = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      verification_tier || consultant.verification_tier || 'blue', consultant_id);

    // Notify consultant
    db.runStmt(`
      INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, 'success', ?, 'verification')
    `, consultant.user_id, 'تم توثيق حسابك', 'تم توثيق حسابك الاستشاري بنجاح ✅', consultant_id);

    req.session.success_msg = '✅ تم توثيق المستشار';
  } else if (action === 'reject') {
    db.runStmt("UPDATE consultants SET verification_tier = 'none', updated_at = CURRENT_TIMESTAMP WHERE id = ?", consultant_id);
    req.session.success_msg = '❌ تم رفض التوثيق';
  }

  res.redirect('/admin/consultants');
});

// =====================================================================
// 💡 SERVICES MANAGEMENT
// =====================================================================
router.get('/services', requireAdmin, (req, res) => {
  const db = getDB();
  const categories = db.all('SELECT * FROM categories WHERE is_active = 1 ORDER BY sort_order');
  const services = db.all(`
    SELECT s.*, c.name_ar as category_name 
    FROM services s 
    LEFT JOIN categories c ON c.id = s.category_id 
    ORDER BY s.category_id, s.sort_order
  `);
  const consultants = db.all("SELECT c.*, u.name as user_name FROM consultants c JOIN users u ON u.id = c.user_id WHERE c.is_verified = 1 ORDER BY u.name");
  const allServices = db.all("SELECT s.*, c.name_ar as cat_name FROM services s LEFT JOIN categories c ON c.id = s.category_id WHERE s.is_active = 1 ORDER BY c.sort_order, s.sort_order");
  
  // For each consultant, get their assigned services
  const consultantServices = {};
  consultants.forEach(con => {
    consultantServices[con.id] = db.all("SELECT service_id FROM consultant_services WHERE consultant_id = ?", con.id).map(r => r.service_id);
  });
  
  res.render('admin/services', { title: 'الخدمات', categories, services, consultants, allServices, consultantServices });
});

router.post('/services/add', requireAdmin, (req, res) => {
  const db = getDB();
  const { category_id, name_ar, description, icon, sort_order } = req.body;
  db.runStmt('INSERT INTO services (category_id, name_ar, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)',
    category_id, name_ar, description, icon || 'bi-bookmark-check', sort_order || 0);
  req.session.success_msg = '✅ تمت إضافة الخدمة';
  res.redirect('/admin/services');
});

router.post('/services/edit', requireAdmin, (req, res) => {
  const db = getDB();
  const { id, category_id, name_ar, description, icon, is_active, sort_order } = req.body;
  db.runStmt('UPDATE services SET category_id=?, name_ar=?, description=?, icon=?, is_active=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
    category_id, name_ar, description, icon || 'bi-bookmark-check', is_active || 1, sort_order || 0, id);
  req.session.success_msg = '✅ تم تحديث الخدمة';
  res.redirect('/admin/services');
});

router.post('/services/delete', requireAdmin, (req, res) => {
  const db = getDB();
  const { id } = req.body;
  db.runStmt('DELETE FROM services WHERE id = ?', id);
  req.session.success_msg = '✅ تم حذف الخدمة';
  res.redirect('/admin/services');
});

// Assign services to consultant (admin)
router.post('/services/assign', requireAdmin, (req, res) => {
  const db = getDB();
  const { consultant_id, service_ids } = req.body;
  
  // Remove existing
  db.runStmt('DELETE FROM consultant_services WHERE consultant_id = ?', consultant_id);
  
  // Add new
  if (service_ids) {
    const ids = Array.isArray(service_ids) ? service_ids : [service_ids];
    ids.forEach(sid => {
      db.runStmt('INSERT OR IGNORE INTO consultant_services (consultant_id, service_id) VALUES (?, ?)',
        consultant_id, sid);
    });
  }
  
  req.session.success_msg = '✅ تم تحديث خدمات المستشار';
  res.redirect('/admin/services');
});

// =====================================================================
// 💾 النسخ الاحتياطي لقاعدة البيانات
// =====================================================================

const BACKUP_DIR = process.env.BACKUP_DIR || process.env.UPLOADS_DIR || path.join(__dirname, '..', 'public');
const backupsPath = path.join(BACKUP_DIR, 'backups');
if (!fs.existsSync(backupsPath)) {
  try { fs.mkdirSync(backupsPath, { recursive: true }); } catch(e) {}
}

// صفحة إدارة النسخ الاحتياطي
router.get('/backup', requireAdmin, (req, res) => {
  const db = getDB();
  
  // Get backup files
  let backups = [];
  try {
    backups = fs.readdirSync(backupsPath)
      .filter(f => f.endsWith('.db') || f.endsWith('.zip'))
      .map(f => {
        const stat = fs.statSync(path.join(backupsPath, f));
        return { name: f, size: stat.size, time: stat.mtime };
      })
      .sort((a, b) => b.time - a.time);
  } catch(e) {}
  
  // Stats
  const stats = {
    users: db.get('SELECT COUNT(*) as c FROM users').c,
    consultants: db.get('SELECT COUNT(*) as c FROM consultants').c,
    consultations: db.get('SELECT COUNT(*) as c FROM consultations').c,
    categories: db.get('SELECT COUNT(*) as c FROM categories').c,
    services: db.get('SELECT COUNT(*) as c FROM services').c,
  };
  
  res.render('admin/backup', { title: 'النسخ الاحتياطي', backups, stats });
});

// إنشاء نسخة احتياطية
router.post('/backup/create', requireAdmin, (req, res) => {
  try {
    const db = getDB();
    
    // Get current DB file path
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'dellini.db');
    
    // Make sure backups dir exists
    if (!fs.existsSync(backupsPath)) {
      fs.mkdirSync(backupsPath, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `dellini-backup-${timestamp}.db`;
    const backupPath = path.join(backupsPath, backupName);
    
    // Force DB save to disk first
    try {
      const data = db.export();
      fs.writeFileSync(dbPath, Buffer.from(data));
    } catch(e) {
      return res.json({ error: 'فشل حفظ قاعدة البيانات: ' + e.message });
    }
    
    // Copy the DB file to backups
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, backupPath);
      req.session.success_msg = `✅ تم إنشاء النسخة: ${backupName} (${(fs.statSync(backupPath).size / 1024).toFixed(1)} KB)`;
    } else {
      req.session.error_msg = `❌ الملف غير موجود: ${dbPath}`;
    }
  } catch(err) {
    console.error('❌ Backup error:', err.message, err.stack);
    req.session.error_msg = `❌ ${err.message}`;
  }
  res.redirect('/admin/backup');
});

// تحميل نسخة احتياطية
router.get('/backup/download/:name', requireAdmin, (req, res) => {
  const name = path.basename(req.params.name);
  const filePath = path.join(backupsPath, name);
  if (fs.existsSync(filePath) && filePath.startsWith(backupsPath)) {
    res.download(filePath);
  } else {
    req.session.error_msg = '❌ الملف غير موجود';
    res.redirect('/admin/backup');
  }
});

// حذف نسخة احتياطية
router.post('/backup/delete', requireAdmin, (req, res) => {
  const name = path.basename(req.body.name || '');
  const filePath = path.join(backupsPath, name);
  if (fs.existsSync(filePath) && filePath.startsWith(backupsPath)) {
    fs.unlinkSync(filePath);
    req.session.success_msg = '✅ تم حذف النسخة الاحتياطية';
  }
  res.redirect('/admin/backup');
});

// استعادة نسخة احتياطية
router.post('/backup/restore', requireAdmin, (req, res) => {
  const name = path.basename(req.body.name || '');
  const backupFile = path.join(backupsPath, name);
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'dellini.db');
  
  if (!fs.existsSync(backupFile)) {
    req.session.error_msg = '❌ الملف غير موجود';
    return res.redirect('/admin/backup');
  }
  
  try {
    // Copy backup to current DB
    fs.copyFileSync(backupFile, DB_PATH);
    req.session.success_msg = `✅ تم استعادة النسخة: ${name}. أعد تشغيل السيرفر (Manual Deploy) عشان التغييرات تطبق.`;
  } catch(err) {
    console.error('Restore error:', err);
    req.session.error_msg = '❌ فشل استعادة النسخة';
  }
  res.redirect('/admin/backup');
});

// رفع ملف قاعدة بيانات واستعادته
const upload = multer({ 
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.db') || file.mimetype === 'application/octet-stream' || file.mimetype === 'application/x-sqlite3') {
      cb(null, true);
    } else {
      cb(new Error('فقط ملفات .db مسموحة'));
    }
  }
});

router.post('/backup/upload-restore', requireAdmin, upload.single('dbfile'), (req, res) => {
  if (!req.file) {
    req.session.error_msg = '❌ يرجى اختيار ملف';
    return res.redirect('/admin/backup');
  }
  
  try {
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'dellini.db');
    // Move uploaded file to DB path
    fs.copyFileSync(req.file.path, DB_PATH);
    // Clean up temp file
    fs.unlinkSync(req.file.path);
    req.session.success_msg = '✅ تم رفع الملف واستبدال قاعدة البيانات. أعد تشغيل السيرفر (Manual Deploy) عشان التغييرات تطبق.';
  } catch(err) {
    console.error('Upload restore error:', err);
    req.session.error_msg = '❌ فشل استعادة الملف';
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch(e) {}
  }
  res.redirect('/admin/backup');
});

// =====================================================================
// 🆔 التحقق من الهويات (Identity Verification)
// =====================================================================

// Identity verification list
router.get('/identity', requireAdmin, (req, res) => {
  const db = getDB();
  const verifications = db.all(`
    SELECT iv.*, u.name as user_name, u.email, u.phone
    FROM identity_verifications iv
    JOIN users u ON u.id = iv.user_id
    ORDER BY iv.created_at DESC
  `);
  res.render('admin/identity', { title: 'التحقق من الهويات', verifications });
});

// Approve / reject identity
router.post('/identity/action', requireAdmin, (req, res) => {
  const db = getDB();
  const { id, action, note } = req.body;
  const status = action === 'approve' ? 'verified' : 'rejected';
  db.runStmt(`UPDATE identity_verifications SET status = ?, admin_note = ?, verified_by = ?, verified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    status, note || null, req.session.user.id, id);
  req.session.success_msg = action === 'approve' ? '✅ تم توثيق الهوية' : '❌ تم رفض الهوية';
  res.redirect('/admin/identity');
});

// 🖨️ تصدير بيانات الهوية كـ PDF
router.get('/identity/pdf/:id', requireAdmin, (req, res) => {
  const db = getDB();
  const v = db.get(`
    SELECT iv.*, u.name as user_name, u.email, u.phone
    FROM identity_verifications iv
    JOIN users u ON u.id = iv.user_id
    WHERE iv.id = ?
  `, req.params.id);
  
  if (!v) {
    req.session.error_msg = '❌ الملف غير موجود';
    return res.redirect('/admin/identity');
  }
  
  try {
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait' });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=identity-${v.id_number || v.id}.pdf`);
    
    doc.pipe(res);
    
    // Header
    doc.fontSize(22).font('Helvetica-Bold').text('دلني', { align: 'center' });
    doc.fontSize(14).font('Helvetica').text('التحقق من الهوية', { align: 'center' });
    doc.moveDown();
    
    // Line
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();
    
    // User info
    doc.fontSize(12).font('Helvetica-Bold').text('معلومات المستخدم');
    doc.fontSize(10).font('Helvetica');
    doc.text(`الاسم: ${v.user_name || '—'}`);
    doc.text(`البريد: ${v.email || '—'}`);
    doc.text(`الجوال: ${v.phone || '—'}`);
    doc.text(`الحالة: ${v.status === 'verified' ? 'موثق' : v.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}`);
    doc.moveDown();
    
    // ID Data
    doc.fontSize(12).font('Helvetica-Bold').text('بيانات الهوية');
    doc.fontSize(10).font('Helvetica');
    doc.text(`الاسم على الهوية: ${v.full_name || '—'}`);
    doc.text(`رقم الهوية: ${v.id_number || '—'}`);
    doc.text(`المصدر: ${v.issuer || '—'}`);
    doc.text(`تاريخ الإصدار: ${v.issue_date || '—'}`);
    doc.text(`تاريخ الانتهاء: ${v.expiry_date || '—'}`);
    doc.text(`تاريخ الميلاد: ${v.birth_date || '—'}`);
    doc.text(`العمر: ${v.age || '—'}`);
    doc.moveDown();
    
    // OCR text
    if (v.ocr_raw_text) {
      doc.fontSize(10).font('Helvetica-Bold').text('النص المستخرج (OCR):');
      doc.fontSize(7).font('Helvetica');
      doc.text(v.ocr_raw_text.slice(0, 800));
    }
    
    // Footer
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#888');
    doc.text(`تاريخ التقرير: ${new Date().toLocaleString('ar-SA')}`, { align: 'center' });
    doc.text(`دلني - منصة استشارات إلكترونية`, { align: 'center' });
    
    doc.end();
  } catch(err) {
    console.error('PDF error:', err);
    req.session.error_msg = '❌ فشل إنشاء PDF';
    res.redirect('/admin/identity');
  }
});

module.exports = router;