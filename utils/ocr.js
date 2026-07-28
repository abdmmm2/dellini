// OCR utility for Saudi National ID card
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

/**
 * Extract text from an ID card image using Tesseract OCR
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<{rawText: string, fields: object}>}
 */
async function scanNationalId(imagePath) {
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    const { data } = await Tesseract.recognize(imagePath, 'ara', {
      logger: m => {
        if (m.status === 'recognizing text') {
          // Silent progress
        }
      }
    });
    
    const rawText = data.text || '';
    console.log('📝 OCR raw text:', rawText.slice(0, 200));
    
    // Extract fields using regex patterns for Saudi ID card
    const fields = extractFields(rawText);
    
    return { rawText, fields };
  } catch (err) {
    console.error('❌ OCR error:', err.message);
    return { rawText: '', fields: {} };
  }
}

/**
 * Extract structured fields from OCR text
 * Saudi National ID card format:
 * - الاسم: Full name in Arabic
 * - رقم الهوية: 10-digit number (starts with 1)
 * - مصدرها: Issuer (usually "وزارة الداخلية")
 * - تاريخ الانتهاء: Expiry date (DD/MM/YYYY)
 * - تاريخ الميلاد: Birth date
 */
function extractFields(text) {
  const fields = {};
  
  // Remove extra spaces and newlines
  const cleaned = text.replace(/\s+/g, ' ').trim();
  
  // الاسم (Name) - after "الاسم" or "اسم"
  const nameMatch = cleaned.match(/الاسم\s*[:\-]?\s*([^\d]+?)(?:\s+\d|\s+رقم|\s+وزارة|$)/i);
  if (nameMatch) fields.full_name = nameMatch[1].trim();
  
  // رقم الهوية / رقم المدني (10-digit number starting with 1)
  const idMatch = cleaned.match(/(?:رقم\s*(?:الهوية|المدني|الوطني)|الهوية\s*الوطنية)\s*[:\-]?\s*(\d{10})/i);
  if (idMatch) {
    fields.id_number = idMatch[1];
  } else {
    // Fallback: find any 10-digit number
    const fallbackId = cleaned.match(/\b(1\d{9})\b/);
    if (fallbackId) fields.id_number = fallbackId[1];
  }
  
  // مصدرها (Issuer) - usually وزارة الداخلية
  const issuerMatch = cleaned.match(/مصدرها\s*[:\-]?\s*([^\d]+?)(?:\d|$)/i);
  if (issuerMatch) fields.issuer = issuerMatch[1].trim();
  
  // تاريخ الانتهاء / الانتهاء (Expiry date)
  const expiryMatch = cleaned.match(/(?:تاريخ\s*(?:الانتهاء|ا?لانتهاء)|انتهاء)\s*[:\-]?\s*(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})/i);
  if (expiryMatch) fields.expiry_date = expiryMatch[1];
  
  // تاريخ الميلاد / الميلاد (Birth date)
  const birthMatch = cleaned.match(/(?:تاريخ\s*(?:الميلاد|ا?لميلاد)|ميلاد)\s*[:\-]?\s*(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})/i);
  if (birthMatch) fields.birth_date = birthMatch[1];
  
  // تاريخ الإصدار / الإصدار (Issue date)
  const issueMatch = cleaned.match(/(?:تاريخ\s*(?:الإصدار|ا?لإصدار|ا?لاصدار)|إصدار|اصدار)\s*[:\-]?\s*(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})/i);
  if (issueMatch) fields.issue_date = issueMatch[1];
  
  // العمر (Age) - look for "سنة" after a number
  const ageMatch = cleaned.match(/(?:العمر|عمر)\s*[:\-]?\s*(\d+)\s*سنة/i);
  if (ageMatch) fields.age = ageMatch[1];
  
  // Also try to extract from birth_date if age not found
  if (!fields.age && fields.birth_date) {
    try {
      const parts = fields.birth_date.split(/[\/\-\.]/);
      // Try DD/MM/YYYY or YYYY/MM/DD
      let year;
      if (parts[2] && parts[2].length === 4) year = parseInt(parts[2]);
      else if (parts[0] && parts[0].length === 4) year = parseInt(parts[0]);
      if (year) {
        const currentYear = new Date().getFullYear();
        fields.age = String(currentYear - year);
      }
    } catch(e) {}
  }
  
  // Clean up
  Object.keys(fields).forEach(k => {
    if (fields[k]) fields[k] = fields[k].trim();
  });
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
