const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { requireLogin } = require('../middleware/auth');

// Send message (AJAX)
router.post('/send', requireLogin, (req, res) => {
  const db = getDB();
  const { consultation_id, message } = req.body;

  if (!message || !consultation_id) {
    return res.json({ success: false, error: 'الرجاء كتابة الرسالة' });
  }

  // Verify user has access to this consultation
  const consultation = db.get(`
    SELECT * FROM consultations WHERE id = ?
    AND (client_id = ? OR consultant_id = (SELECT id FROM consultants WHERE user_id = ?))
  `, consultation_id, req.session.user.id, req.session.user.id);

  if (!consultation) {
    return res.json({ success: false, error: 'لا تملك صلاحية الوصول لهذه الاستشارة' });
  }

  const senderRole = req.session.user.role === 'client' ? 'client' : 'consultant';

  const result = db.runStmt(`
    INSERT INTO messages (consultation_id, sender_id, sender_role, message)
    VALUES (?, ?, ?, ?)
  `, consultation_id, req.session.user.id, senderRole, message);

  // Mark consultation as answered if consultant replies
  if (senderRole === 'consultant' && (consultation.status === 'assigned' || consultation.status === 'paid')) {
    db.runStmt("UPDATE consultations SET status = '" + "answered" + "', updated_at = CURRENT_TIMESTAMP WHERE id = ?", consultation_id);
  }

  // Notify the other party
  const notifyUserId = senderRole === 'client' ? 
    db.get('SELECT user_id FROM consultants WHERE id = ?', consultation.consultant_id)?.user_id :
    consultation.client_id;

  if (notifyUserId) {
    const notificationType = senderRole === 'consultant' ? 'new_reply' : 'new_reply';
    const notificationTitle = senderRole === 'consultant' ? '💬 رد من المستشار' : '💬 رسالة جديدة';
    
    db.runStmt(`
      INSERT INTO notifications (user_id, title, message, type, related_id, related_type)
      VALUES (?, ?, ?, ?, ?, 'consultation')
    `, notifyUserId, notificationTitle, 'لديك رد جديد على الاستشارة', notificationType, consultation_id);
  }

  res.json({
    success: true,
    message: {
      id: result.lastInsertRowid,
      message,
      sender_role: senderRole,
      sender_name: req.session.user.name,
      created_at: new Date().toISOString()
    }
  });
});

// Get messages for a consultation (AJAX)
router.get('/:consultationId', requireLogin, (req, res) => {
  const db = getDB();
  const consultationId = req.params.consultationId;

  const consultation = db.get(`
    SELECT * FROM consultations WHERE id = ?
    AND (client_id = ? OR consultant_id = (SELECT id FROM consultants WHERE user_id = ?))
  `, consultationId, req.session.user.id, req.session.user.id);

  if (!consultation) {
    return res.json({ success: false, error: 'غير مصرح' });
  }

  const messages = db.all(`
    SELECT m.*, u.name as sender_name
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.consultation_id = ?
    ORDER BY m.created_at ASC
  `, consultationId);

  // Mark messages as read
  db.runStmt(`
    UPDATE messages SET is_read = 1
    WHERE consultation_id = ? AND sender_id != ?
  `, consultationId, req.session.user.id);

  res.json({ success: true, messages });
});

module.exports = router;
