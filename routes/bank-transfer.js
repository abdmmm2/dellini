const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDB, saveDB } = require('../database');
const { requireLogin } = require('../middleware/auth');

// Multer config for receipt uploads
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..');
const receiptDir = path.join(UPLOADS_DIR, 'public', 'uploads', 'receipts');

// Ensure directory exists
if (!fs.existsSync(receiptDir)) {
  fs.mkdirSync(receiptDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, receiptDir),
  filename: (req, file, cb) => {
    const uniqueName = 'receipt_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});
const uploadReceipt = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|bmp|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext || mime) return cb(null, true);
    cb(new Error('فقط الصور وملفات PDF مسموحة'));
  }
});

// =====================================================================
// 📄 OCR Function - Extract text from receipt image
// =====================================================================
async function ocrReceipt(imagePath) {
  try {
    const Tesseract = require('tesseract.js');
    const sharp = require('sharp');
    
    // Preprocess image: convert to greyscale, increase contrast
    const processedPath = imagePath.replace(/(\.\w+)$/, '_processed$1');
    await sharp(imagePath)
      .greyscale()
      .normalise()
      .sharpen()
      .jpeg({ quality: 95 })
      .toFile(processedPath);
    
    const { data } = await Tesseract.recognize(
      processedPath,
      'ara',  // Arabic + English
      { 
        logger: m => {},
        tessedit_pageseg_mode: '3'
      }
    );
    
    // Clean up processed file
    try { fs.unlinkSync(processedPath); } catch(e) {}
    
    // Extract structured data from OCR text
    const text = data.text;
    const extracted = {
      raw_text: text,
      confidence: data.confidence,
      transfer_number: extractField(text, ['رقم الحوالة', 'رقم العملية', 'رقم المرجع', 'رقم التحويل', 'حوالة رقم', 'عملية رقم']),
      bank_name: extractField(text, ['بنك', 'مصرف', 'Bank']),
      sender_name: extractField(text, ['اسم المحول', 'اسم المرسل', 'المحول', 'المرسل', 'Sender']),
      recipient_name: extractField(text, ['اسم المستفيد', 'اسم المدفوع له', 'المستفيد', 'المدفوع له', 'اسم المحول له', 'المحول له', 'Beneficiary']),
      transfer_date: extractDate(text),
      amount: extractAmount(text)
    };
    
    return extracted;
  } catch (err) {
    console.error('OCR Error:', err.message);
    return { raw_text: '', error: err.message };
  }
}

function extractField(text, keywords) {
  const lines = text.split('\n');
  for (const keyword of keywords) {
    for (const line of lines) {
      if (line.includes(keyword)) {
        // Return text after the keyword
        const idx = line.indexOf(keyword) + keyword.length;
        const value = line.substring(idx).replace(/^[:.\s\-]+/, '').trim();
        if (value && value.length < 100) return value;
      }
    }
  }
  return '';
}

function extractDate(text) {
  const datePatterns = [
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/.source,
    /(\d{4})-(\d{2})-(\d{2})/.source,
    /(\d{1,2})\s+(\d{1,2}:\d{2})\s+(AM|PM)/i.source,
  ];
  
  // Try to find dates
  const dateRegex = /\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/g;
  const matches = text.match(dateRegex);
  return matches ? matches.join(', ') : '';
}

function extractAmount(text) {
  const amountRegex = /(\d[\d,]*\.?\d*)\s*(ريال|SR|SAR|رس)/g;
  const matches = text.match(amountRegex);
  return matches ? matches[0] : '';
}

// =====================================================================
// 🏦 Bank Transfer Routes
// =====================================================================

// Show bank transfer form
router.get('/bank-transfer/:consultationId', requireLogin, (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?", 
    req.params.consultationId, req.session.user.id);
  
  if (!consultation) {
    req.session.error_msg = 'الاستشارة غير موجودة';
    return res.redirect('/client');
  }

  if (consultation.payment_status === 'paid') {
    req.session.success_msg = 'تم الدفع مسبقاً';
    return res.redirect('/client');
  }

  // Get bank settings
  const settings = {};
  const rows = db.all('SELECT * FROM payment_settings');
  rows.forEach(r => { settings[r.key] = r.value; });

  // Check if user already submitted a transfer for this consultation
  const existingTransfer = db.get('SELECT * FROM bank_transfers WHERE consultation_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1',
    req.params.consultationId, req.session.user.id);

  res.render('client/bank-transfer', { 
    title: 'تحويل بنكي', 
    consultation, 
    settings,
    existingTransfer
  });
});

// Submit bank transfer
router.post('/bank-transfer/submit/:consultationId', requireLogin, uploadReceipt.single('receipt'), async (req, res) => {
  const db = getDB();
  const consultation = db.get("SELECT * FROM consultations WHERE id = ? AND client_id = ?", 
    req.params.consultationId, req.session.user.id);

  if (!consultation) {
    return res.status(404).json({ error: 'الاستشارة غير موجودة' });
  }

  const { bank_name, sender_name, recipient_name, transfer_number, transfer_date } = req.body;
  
  let receiptPath = null;
  let ocrResult = null;

  if (req.file) {
    receiptPath = '/uploads/receipts/' + req.file.filename;
    
    // Run OCR on the receipt
    const fullPath = req.file.path;
    ocrResult = await ocrReceipt(fullPath);
  }

  // Save to database
  db.runStmt(`
    INSERT INTO bank_transfers (consultation_id, user_id, bank_name, sender_name, recipient_name, transfer_number, transfer_date, receipt_image, ocr_data, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `, 
    req.params.consultationId, 
    req.session.user.id,
    bank_name || (ocrResult ? ocrResult.bank_name : ''),
    sender_name || (ocrResult ? ocrResult.sender_name : ''),
    recipient_name || (ocrResult ? ocrResult.recipient_name : ''),
    transfer_number || (ocrResult ? ocrResult.transfer_number : ''),
    transfer_date || (ocrResult ? ocrResult.transfer_date : ''),
    receiptPath,
    JSON.stringify(ocrResult || {})
  );

  // Update consultation status to pending payment
  db.runStmt(`UPDATE consultations SET payment_status = 'pending', status = 'pending_payment', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    req.params.consultationId);

  // Notify admins
  const admins = db.all("SELECT id FROM users WHERE role IN ('admin','supervisor')");
  admins.forEach(admin => {
    db.runStmt(`INSERT INTO notifications (user_id, title, message, type, related_id, related_type) VALUES (?, ?, ?, 'info', ?, 'bank_transfer')`,
      admin.id, 
      '📄 تحويل بنكي جديد', 
      `تم استلام طلب تحويل بنكي من ${sender_name || req.session.user.name} للاستشارة #${req.params.consultationId}`,
      req.params.consultationId);
  });

  res.json({ 
    success: true,
    message: '✅ تم إرسال بيانات التحويل. سيتم تأكيد الدفع من قبل الإدارة.',
    ocr_hint: ocrResult && ocrResult.raw_text ? 'تمت قراءة الإيصال ضوئياً' : 'يرجى تعبئة البيانات يدوياً'
  });
});

module.exports = router;
