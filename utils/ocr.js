// OCR utility for Saudi National ID card
// Uses OCR.space API (free, 25K requests/month, excellent Arabic support)
const fs = require('fs');
const path = require('path');
const https = require('https');

const OCR_API_KEY = process.env.OCR_API_KEY || 'helloworld'; // Free tier key

/**
 * Extract text from an ID card image using OCR.space API
 */
async function scanNationalId(imagePath) {
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    // Read image as base64
    const imageData = fs.readFileSync(imagePath);
    const base64 = imageData.toString('base64');
    
    // Call OCR.space API
    const result = await callOcrSpace(base64);
    
    if (!result || !result.ParsedResults || !result.ParsedResults.length) {
      console.log('⚠️ OCR: No results');
      return { rawText: '', fields: {} };
    }
    
    const rawText = result.ParsedResults[0].ParsedText || '';
    console.log('📝 OCR text (first 500):', rawText.slice(0, 500));
    
    const fields = extractFields(rawText);
    console.log('📋 Fields:', JSON.stringify(fields));
    
    return { rawText, fields };
  } catch (err) {
    console.error('❌ OCR error:', err.message);
    return { rawText: '', fields: {} };
  }
}

/**
 * Call OCR.space API
 */
function callOcrSpace(base64Image) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      base64Image: `data:image/jpeg;base64,${base64Image}`,
      language: 'ara',  // Arabic
      OCREngine: 2,      // More accurate engine
      isTable: false,
      detectOrientation: true,
      scale: true,
    });
    
    const options = {
      hostname: 'api.ocr.space',
      path: '/parse/image',
      method: 'POST',
      headers: {
        'apikey': OCR_API_KEY,
        'Content-Type': 'application/json',
      },
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.IsErroredOnProcessing) {
            reject(new Error(parsed.ErrorMessage || 'OCR API error'));
          } else {
            resolve(parsed);
          }
        } catch(e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Extract structured fields from OCR text - Saudi National ID card
 */
function extractFields(text) {
  const fields = {};
  
  // Normalize text
  let cleaned = text.replace(/[\s\n\r]+/g, ' ').replace(/[ـ\-_]+/g, '').trim();
  
  // رقم الهوية (10 digits, starts with 1)
  const idPatterns = [
    /رقم\s*(?:الهوية|المدني|الوطني)\s*[:\-]?\s*(\d{10,})/i,
    /(?:الهوية\s*الوطنية|الرقم\s*الوطني)\s*[:\-]?\s*(\d{10,})/i,
  ];
  for (const p of idPatterns) {
    const m = cleaned.match(p);
    if (m) { fields.id_number = m[1].slice(0, 10); break; }
  }
  if (!fields.id_number) {
    const fb = cleaned.match(/\b(1\d{9})\b/);
    if (fb) fields.id_number = fb[1];
  }
  
  // الاسم
  const namePatterns = [
    /الاسم\s*[:\-]?\s*([^\d\r\n]{4,60}?)(?:\s{2,}|\s*\d|\s*رقم)/i,
    /اسم\s*[:\-]?\s*([^\d\r\n]{4,60}?)(?:\s{2,}|\s*\d)/i,
  ];
  for (const p of namePatterns) {
    const m = cleaned.match(p);
    if (m) { const n = m[1].trim(); if (n.length > 3) { fields.full_name = n; break; } }
  }
  
  // المصدر
  const issuerMatch = cleaned.match(/(?:مصدرها|جهة\s*الإصدار)\s*[:\-]?\s*([^\d\r\n]{3,60}?)(?:\s{2,}|\d|$)/i);
  if (issuerMatch) fields.issuer = issuerMatch[1].trim();
  if (!fields.issuer) {
    const w = cleaned.match(/(وزارة[^\d\r\n]{2,30}?)(?:\s{2,}|\d|$)/);
    if (w) fields.issuer = w[1].trim();
  }
  
  // Dates
  const allDates = [];
  const dateRegex = /(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/g;
  let match;
  while ((match = dateRegex.exec(cleaned)) !== null) {
    allDates.push({ raw: match[0], d1: match[1], d2: match[2], d3: match[3], pos: match.index });
  }
  
  allDates.forEach(d => {
    const context = cleaned.slice(Math.max(0, d.pos - 50), d.pos + 15);
    if (/انتهاء|تنتهي|صالحة|expiry|valid/i.test(context)) {
      fields.expiry_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    } else if (/الميلاد|ميلاد|ازدياد|birth/i.test(context)) {
      fields.birth_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    } else if (/إصدار|اصدار|صدر|issue/i.test(context)) {
      fields.issue_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
  });
  
  // If unclassified dates exist, try to assign by position
  if (allDates.length >= 2) {
    if (!fields.issue_date) {
      const d = allDates[0];
      fields.issue_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
    if (!fields.expiry_date) {
      const d = allDates[allDates.length - 1];
      fields.expiry_date = d.d3.length === 4 ? `${d.d3}-${d.d2.padStart(2,'0')}-${d.d1.padStart(2,'0')}` : d.raw;
    }
  }
  
  // العمر
  const ageMatch = cleaned.match(/(?:العمر|عمر|السن)\s*[:\-]?\s*(\d+)\s*(?:سنة|عام)/i);
  if (ageMatch) fields.age = ageMatch[1];
  else if (fields.birth_date) {
    try {
      const parts = fields.birth_date.split('-');
      let year = parseInt(parts[0]);
      if (year > 2026 || year < 1900) year = parseInt(parts[2]);
      if (year > 1900 && year < 2026) fields.age = String(new Date().getFullYear() - year);
    } catch(e) {}
  }
  
  // Clean
  Object.keys(fields).forEach(k => { if (fields[k]) fields[k] = fields[k].trim(); });
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
