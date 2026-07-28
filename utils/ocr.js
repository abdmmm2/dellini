// OCR utility for Saudi National ID card
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

/**
 * Pre-process image for better OCR (resize, convert to grayscale, increase contrast)
 */
async function preprocessImage(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: 1200, withoutEnlargement: false })
      .grayscale()
      .normalise()
      .jpeg({ quality: 90 })
      .toFile(outputPath);
    return outputPath;
  } catch (e) {
    console.error('Image preprocessing error:', e.message);
    return inputPath;
  }
}

/**
 * Extract text from an ID card image using Tesseract OCR
 */
async function scanNationalId(imagePath) {
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    // Preprocess image for better OCR
    const processedPath = imagePath.replace(/(\.\w+)$/, '-processed$1');
    const sharpPath = await preprocessImage(imagePath, processedPath);
    
    // Run OCR with Arabic + English
    const { data } = await Tesseract.recognize(sharpPath, 'ara+eng', {
      logger: () => {},
    });
    
    const rawText = data.text || '';
    console.log('📝 OCR raw text (first 500 chars):', rawText.slice(0, 500));
    
    const fields = extractFields(rawText);
    console.log('📋 Extracted fields:', JSON.stringify(fields));
    
    // Clean up processed file
    try { fs.unlinkSync(processedPath); } catch(e) {}
    
    return { rawText, fields };
  } catch (err) {
    console.error('❌ OCR error:', err.message);
    return { rawText: '', fields: {} };
  }
}

/**
 * Extract structured fields from OCR text - Saudi National ID card
 */
function extractFields(text) {
  const fields = {};
  
  // Normalize text
  let cleaned = text
    .replace(/[\s\n\r]+/g, ' ')   // collapse whitespace
    .replace(/[ـ\-_]+/g, '')      // remove tatweel/dashes
    .replace(/[｜|]/g, '')        // remove pipe chars
    .trim();
  
  // Debug: show cleaned text
  console.log('📋 Cleaned text:', cleaned.slice(0, 300));
  
  // =============================================
  // رقم الهوية (10 digits, starts with 1)
  // =============================================
  // Try: explicit label followed by number
  const idPatterns = [
    /رقم\s*(?:الهوية|المدني|الوطني|الحوالة)\s*[:\-]?\s*(\d{10,})/i,
    /الهوية\s*(?:الوطنية)?\s*[:\-]?\s*(\d{10,})/i,
    /الرقم\s*(?:الوطني)?\s*[:\-]?\s*(\d{10,})/i,
  ];
  for (const p of idPatterns) {
    const m = cleaned.match(p);
    if (m) { fields.id_number = m[1].slice(0, 10); break; }
  }
  // Fallback: standalone 10-digit number starting with 1
  if (!fields.id_number) {
    const fb = cleaned.match(/\b(1\d{9})\b/);
    if (fb) fields.id_number = fb[1];
  }
  
  // =============================================
  // رقم الإصدار (Issue Number) - 8+ digits
  // =============================================
  // (Used to find name context)
  
  // =============================================
  // الاسم (Name)
  // =============================================
  const namePatterns = [
    /الاسم\s*[:\-]?\s*([^\d\r\n]{4,60}?)(?:\s{2,}|\s+\d|\s*رقم|$)/i,
    /اسم\s*[:\-]?\s*([^\d\r\n]{4,60}?)(?:\s{2,}|\s+\d|\s*رقم|$)/i,
    /([^\d\r\n]{4,60})\s*رقم\s*(?:الهوية|المدني)/i,
  ];
  for (const p of namePatterns) {
    const m = cleaned.match(p);
    if (m) {
      const n = m[1].replace(/[^\\u0600-\\u06FF\\s]/g, '').trim();
      if (n.length > 3) { fields.full_name = n; break; }
    }
  }
  
  // =============================================
  // مصدرها (Issuer) - usually وزارة الداخلية
  // =============================================
  const issuerMatch = cleaned.match(/(?:مصدرها|جهة\s*(?:الإصدار|الاصدار)|جهة)\s*[:\-]?\s*([^\d\r\n]{3,50}?)(?:\s{2,}|\d|$)/i);
  if (issuerMatch) {
    fields.issuer = issuerMatch[1].trim();
  }
  if (!fields.issuer) {
    const w = cleaned.match(/(وزارة[^\d\r\n]{2,30}?)(?:\s{2,}|\d|$)/);
    if (w) fields.issuer = w[1].trim();
  }
  
  // =============================================
  // Dates (various)
  // =============================================
  // Find all date-like patterns: DD/MM/YYYY or YYYY/MM/DD
  // Saudi ID usually has dates in format: DD/MM/YYYY or DD-MM-YYYY
  const allDates = [];
  const dateRegex = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/g;
  let match;
  while ((match = dateRegex.exec(cleaned)) !== null) {
    allDates.push({
      raw: match[0],
      d1: match[1], d2: match[2], d3: match[3],
      pos: match.index
    });
  }
  
  // Classify dates based on surrounding context
  allDates.forEach((d, i) => {
    const context = cleaned.slice(Math.max(0, d.pos - 40), d.pos + 10);
    
    // Check for expiry indicators
    if (/انتهاء|تنتهي|صالحة|expiry|valid/i.test(context)) {
      fields.expiry_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
    // Check for birth indicators  
    else if (/الميلاد|ميلاد|ازدياد|birth/i.test(context)) {
      fields.birth_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
    // Check for issue indicators
    else if (/إصدار|اصدار|صدر|issue/i.test(context)) {
      fields.issue_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
  });
  
  // If dates found but not classified, try to assign by position
  if (allDates.length >= 2 && !fields.expiry_date && !fields.issue_date) {
    // The last date is usually expiry
    if (!fields.expiry_date) {
      const d = allDates[allDates.length - 1];
      fields.expiry_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
    // The first date is usually issue
    if (!fields.issue_date) {
      const d = allDates[0];
      fields.issue_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
  }
  
  // =============================================
  // العمر (Age)
  // =============================================
  const ageMatch = cleaned.match(/(?:العمر|عمر|السن)\s*[:\-]?\s*(\d+)\s*(?:سنة|عام)/i);
  if (ageMatch) fields.age = ageMatch[1];
  else if (fields.birth_date) {
    try {
      // Try YYYY-MM-DD or DD-MM-YYYY
      const parts = fields.birth_date.split('-');
      let year = parseInt(parts[0]);
      if (year > 2026 || year < 1900) year = parseInt(parts[2]);
      if (year > 1900 && year < 2026) fields.age = String(new Date().getFullYear() - year);
    } catch(e) {}
  }
  
  // Clean up
  Object.keys(fields).forEach(k => {
    if (fields[k]) fields[k] = fields[k].trim();
  });
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
