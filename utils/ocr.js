// OCR utility for Saudi National ID card
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

/**
 * Pre-process image for optimal OCR
 */
async function preprocessImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: 1500, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .sharpen()
      .jpeg({ quality: 95 })
      .toFile(outputPath);
    return outputPath;
  } catch (e) {
    console.error('Preprocess error:', e.message);
    return inputPath;
  }
}

/**
 * Extract text from an ID card image using Tesseract.js
 */
async function scanNationalId(imagePath) {
  let worker = null;
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    // Preprocess
    const procPath = imagePath.replace(/(\.\w+)$/, '-proc$1');
    const imgPath = await preprocessImage(imagePath, procPath);
    
    // Create worker with Arabic
    console.log('🔍 Creating Tesseract worker...');
    worker = await Tesseract.createWorker('ara', 1, {
      logger: () => {}
    });
    
    console.log('🔍 Recognizing...');
    const { data } = await worker.recognize(imgPath);
    
    // Cleanup processed file
    try { fs.unlinkSync(procPath); } catch(e) {}
    
    const rawText = data.text || '';
    console.log('📝 OCR text (first 500):', rawText.slice(0, 500));
    
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

/**
 * Extract fields from OCR text - Saudi National ID
 */
function extractFields(text) {
  const fields = {};
  const cleaned = text.replace(/[\s\n\r]+/g, ' ').replace(/[ـ\-_]+/g, '').trim();
  
  // رقم الهوية
  const idMatch = cleaned.match(/رقم\s*(?:الهوية|المدني|الوطني)\s*[:\-]?\s*(\d{10,})/i);
  if (idMatch) fields.id_number = idMatch[1].slice(0,10);
  
  // الاسم
  const nameMatch = cleaned.match(/(?:الاسم|اسم)\s*[:\-]?\s*([^\d\r\n]{4,60}?)(?:\s{2,}|\s*\d|\s*رقم)/i);
  if (nameMatch) { const n = nameMatch[1].trim(); if (n.length > 3) fields.full_name = n; }
  
  // المصدر
  const issueM = cleaned.match(/مصدرها\s*[:\-]?\s*([^\d\r\n]{3,50}?)(?:\s{2,}|\d|$)/i);
  if (issueM) fields.issuer = issueM[1].trim();
  
  // Dates
  const dates = [];
  let m;
  const dr = /(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/g;
  while ((m = dr.exec(cleaned)) !== null) {
    const ctx = cleaned.slice(Math.max(0, m.index - 40), m.index + 5);
    dates.push({ d1: m[1], d2: m[2], d3: m[3], ctx, pos: m.index });
  }
  
  dates.forEach(d => {
    if (/انتهاء|تنتهي|صالحة|expiry/i.test(d.ctx)) {
      fields.expiry_date = d.d3.length === 4 ? `${d.d3}/${d.d2.padStart(2,'0')}/${d.d1.padStart(2,'0')}` : d.raw;
    } else if (/الميلاد|ميلاد|birth/i.test(d.ctx)) {
      fields.birth_date = d.d3.length === 4 ? `${d.d3}/${d.d2.padStart(2,'0')}/${d.d1.padStart(2,'0')}` : d.raw;
    } else if (/إصدار|اصدار|صدر|issue/i.test(d.ctx)) {
      fields.issue_date = d.d3.length === 4 ? `${d.d3}/${d.d2.padStart(2,'0')}/${d.d1.padStart(2,'0')}` : d.raw;
    }
  });
  
  // Fallback: assign dates
  if (dates.length >= 2 && !fields.issue_date && !fields.expiry_date) {
    const sorted = dates.sort((a,b) => a.pos - b.pos);
    const first = sorted[0], last = sorted[sorted.length-1];
    fields.issue_date = first.d3.length === 4 ? `${first.d3}/${first.d2}/${first.d1}` : first.raw;
    fields.expiry_date = last.d3.length === 4 ? `${last.d3}/${last.d2}/${last.d1}` : last.raw;
  }
  
  // العمر
  if (fields.birth_date) {
    const parts = fields.birth_date.split('/');
    let year = parseInt(parts[0]);
    if (year > 2026 || year < 1900) year = parseInt(parts[2]);
    if (year > 1900 && year < 2026) fields.age = String(new Date().getFullYear() - year);
  }
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
