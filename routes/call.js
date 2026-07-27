// 🎧 Voice call room for consultations
const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { requireLogin } = require('../middleware/auth');

// Show call page
router.get('/:consultationId', requireLogin, (req, res) => {
  const db = getDB();
  const consultation = db.get(`
    SELECT cns.*, cat.name_ar as category_name,
      CASE WHEN cns.consultant_id IS NOT NULL THEN u.name ELSE NULL END as consultant_name,
      cl.name as client_name
    FROM consultations cns
    LEFT JOIN categories cat ON cat.id = cns.category_id
    LEFT JOIN consultants con ON con.id = cns.consultant_id
    LEFT JOIN users u ON u.id = con.user_id
    LEFT JOIN users cl ON cl.id = cns.client_id
    WHERE cns.id = ?
  `, req.params.consultationId);

  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/');
  }

  // Check if user is authorized (client or consultant of this consultation)
  const userId = req.session.user.id;
  const isClient = consultation.client_id === userId;
  
  // Check if consultant
  let isConsultant = false;
  if (consultation.consultant_id) {
    const consultantUser = db.get('SELECT user_id FROM consultants WHERE id = ?', consultation.consultant_id);
    isConsultant = consultantUser && consultantUser.user_id === userId;
  }
  
  // Check if admin
  const isAdmin = ['admin', 'supervisor'].includes(req.session.user.role);

  if (!isClient && !isConsultant && !isAdmin) {
    req.session.error_msg = 'لا تملك صلاحية الوصول إلى هذه المكالمة';
    return res.redirect('/');
  }

  if (consultation.type !== 'voice') {
    req.session.error_msg = 'هذه الاستشارة ليست مكالمة صوتية';
    return res.redirect('/');
  }

  // Generate a unique room name for Jitsi
  const roomName = `dellini_${consultation.id}_${consultation.created_at}`;
  const displayName = isClient ? (req.session.user.name || 'عميل') : (req.session.user.name || 'مستشار');

  // Get voice settings
  const settings = {};
  const rows = db.all('SELECT * FROM payment_settings');
  rows.forEach(r => { settings[r.key] = r.value; });

  const domain = settings.voice_app_id || 'meet.jit.si'; // default to public Jitsi

  res.render('call', {
    title: `مكالمة #${consultation.id}`,
    consultation,
    roomName,
    displayName,
    domain,
    userRole: req.session.user.role,
    backUrl: isClient ? `/client/consultation/${consultation.id}` : `/consultant/consultation/${consultation.id}`,
    layout: false  // No layout for call page
  });
});

module.exports = router;
