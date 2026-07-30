// OCR utility for Saudi National ID card
const Tesseract = require('tesseract.js');
const fs = require('fs');
const sharp = require('sharp');

async function preprocessImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: 2000, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .sharpen()
      .linear(1.5, -30)
      .jpeg({ quality: 95 })
      .toFile(outputPath);
    return outputPath;
  } catch (e) { return inputPath; }
}

async function scanNationalId(imagePath) {
  let worker = null;
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    const procPath = imagePath.replace(/(\.\w+)$/, '-proc$1');
    await preprocessImage(imagePath, procPath);
    
    worker = await Tesseract.createWorker('ara+eng', 1, { logger: () => {} });
    
    const { data } = await worker.recognize(procPath);
    try { fs.unlinkSync(procPath); } catch(e) {}
    
    const rawText = data.text || '';
    console.log('📝 OCR text:', rawText.slice(0, 500));
    
    const fields = extractFields(rawText);
    console.log('📋 Fields:', JSON.stringify(fields));
    
    return { rawText, fields };
  } catch (err) {
    console.error('❌ OCR error:', err.message);
    return { rawText: '', fields: {} };
  } finally {
    if (worker) try { await worker.terminate(); } catch(e) {}
  }
}

function extractFields(text) {
  const fields = {};
  let cleaned = text.replace(/[\n\r]+/g, ' ').replace(/[ـ\-_]+/g, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // رقم الهوية - 10 digits starting with 1
  const idMatch = cleaned.match(/\b(1\d{9})\b/);
  if (idMatch) fields.id_number = idMatch[1];
  
  // الاسم - look for Arabic text patterns
  const nameMatch = cleaned.match(/(?:الاسم|اسم)\s*[:\-]?\s*([\u0600-\u06FF\s]{4,60}?)(?:\s+\d|\s*رقم|$)/i);
  if (nameMatch) { const n = nameMatch[1].trim(); if (n.length > 3) fields.full_name = n; }
  
  // المصدر
  const issuerMatch = cleaned.match(/(?:مصدرها|جهة|وزارة)\s*[:\-]?\s*([\u0600-\u06FF\s]{3,50}?)(?:\s+\d|$)/i);
  if (issuerMatch) fields.issuer = issuerMatch[1].trim();
  
  // All dates
  const dates = [];
  let m;
  const dr = /(\d{1,4})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{1,4})/g;
  while ((m = dr.exec(cleaned)) !== null) {
    dates.push({ idx: m.index, d: `${m[1]}/${m[2]}/${m[3]}`, raw: m[0] });
  }
  
  // Classify dates by context
  dates.forEach(d => {
    const ctx = cleaned.slice(Math.max(0, d.idx - 30), d.idx + 30);
    if (/انتهاء|تنتهي|expiry|valid/i.test(ctx)) {
      fields.expiry_date = d.d;
    } else if (/الميلاد|ميلاد|ازدياد|birth/i.test(ctx)) {
      fields.birth_date = d.d;
    } else if (/إصدار|اصدار|صدر|issue/i.test(ctx)) {
      fields.issue_date = d.d;
    }
  });
  
  // Fallback: assign dates by position
  if (dates.length >= 2) {
    if (!fields.issue_date) fields.issue_date = dates[0].d;
    if (!fields.expiry_date) fields.expiry_date = dates[dates.length - 1].d;
    if (!fields.birth_date && dates.length >= 3) {
      // Middle date is usually birth date
      const birthDates = dates.filter(d => d.d !== fields.issue_date && d.d !== fields.expiry_date);
      if (birthDates.length > 0) fields.birth_date = birthDates[0].d;
    }
  }
  
  // Age from birth date
  if (fields.birth_date) {
    const parts = fields.birth_date.split('/');
    let year = parseInt(parts[0]);
    if (year > 2026 || year < 1900) year = parseInt(parts[2]);
    if (year > 1900 && year < 2026) fields.age = String(new Date().getFullYear() - year);
  }
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
