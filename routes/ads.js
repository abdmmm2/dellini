const express = require('express');
const router = express.Router();
const { getDB } = require('../database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

router.use(requireLogin);
router.use(requireAdmin);

// Uploads directory — use volume path in Fly.io, local path otherwise
const UPLOADS_BASE = process.env.UPLOADS_DIR 
  ? path.join(process.env.UPLOADS_DIR, 'uploads', 'ads')
  : path.join(__dirname, '..', 'public', 'uploads', 'ads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = UPLOADS_BASE;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, 'ad_' + Date.now() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('فقط الصور مسموحة: JPG, PNG, GIF, WEBP, SVG'));
    }
  }
});

// ─── Ads Management ───
router.get('/', (req, res) => {
  const db = getDB();
  const ads = db.all('SELECT * FROM ads ORDER BY sort_order');
  res.render('admin/ads', { title: 'إدارة الإعلانات', ads });
});

// Add ad
router.post('/add', upload.single('ad_image'), (req, res) => {
  const db = getDB();
  const { title, description, link_url, sort_order, bg_color } = req.body;

  if (!title) {
    req.session.error_msg = 'عنوان الإعلان مطلوب';
    return res.redirect('/admin/ads');
  }

  let image_url = bg_color || '#6f42c1';
  if (req.file) {
    image_url = process.env.UPLOADS_DIR 
      ? '/uploads/ads/' + req.file.filename 
      : '/uploads/ads/' + req.file.filename;
  }

  db.runStmt("INSERT INTO ads (title, description, image_url, link_url, sort_order) VALUES (?, ?, ?, ?, ?)",
    title, description || '', image_url, link_url || '/', parseInt(sort_order) || 0);

  req.session.success_msg = 'تم إضافة الإعلان بنجاح';
  res.redirect('/admin/ads');
});

// Edit ad
router.post('/edit', upload.single('ad_image'), (req, res) => {
  const db = getDB();
  const { id, title, description, link_url, sort_order, is_active, bg_color, existing_image } = req.body;

  let image_url = bg_color || '#6f42c1';
  if (req.file) {
    image_url = '/uploads/ads/' + req.file.filename;
    // Delete old uploaded image
    if (existing_image && existing_image.startsWith('/uploads/')) {
      const oldPath = path.join(UPLOADS_BASE, path.basename(existing_image));
      try { fs.unlinkSync(oldPath); } catch(e) {}
    }
  } else if (existing_image) {
    image_url = existing_image;
  }

  db.runStmt("UPDATE ads SET title=?, description=?, image_url=?, link_url=?, sort_order=?, is_active=? WHERE id=?",
    title, description || '', image_url, link_url || '/', parseInt(sort_order) || 0, is_active ? 1 : 0, id);

  req.session.success_msg = 'تم تحديث الإعلان بنجاح';
  res.redirect('/admin/ads');
});

// Delete ad
router.post('/delete', (req, res) => {
  const db = getDB();
  const { id } = req.body;

  const ad = db.get('SELECT image_url FROM ads WHERE id = ?', id);
  if (ad && ad.image_url && ad.image_url.startsWith('/uploads/')) {
    const filePath = path.join(UPLOADS_BASE, path.basename(ad.image_url));
    try { fs.unlinkSync(filePath); } catch(e) {}
  }

  db.runStmt("DELETE FROM ads WHERE id = ?", id);
  req.session.success_msg = 'تم حذف الإعلان';
  res.redirect('/admin/ads');
});

// Track click
router.post('/click', (req, res) => {
  const db = getDB();
  const { id } = req.body;
  db.runStmt("UPDATE ads SET clicks = clicks + 1 WHERE id = ?", id);
  res.json({ success: true });
});

module.exports = router;
