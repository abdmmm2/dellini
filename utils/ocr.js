// OCR utility for Saudi National ID card
const Tesseract = require('tesseract.js');
const path = require('path');
const fs = require('fs');

/**
 * Extract text from an ID card image using Tesseract OCR
 */
async function scanNationalId(imagePath) {
  try {
    console.log('🔍 OCR: processing', imagePath);
    
    // Run OCR with Arabic + English
    const { data } = await Tesseract.recognize(imagePath, 'ara+eng', {
      logger: () => {}
    });
    
    const rawText = data.text || '';
    console.log('📝 OCR raw text (first 300 chars):', rawText.slice(0, 300));
    
    const fields = extractFields(rawText);
    console.log('📋 Extracted fields:', JSON.stringify(fields));
    
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
  const cleaned = text.replace(/\s+/g, ' ').trim();
  
  // =============================================
  // رقم الهوية (10 digits, starts with 1)
  // =============================================
  // Pattern: "رقم الهوية" or "رقم المدني" followed by 10 digits
  const idMatch = cleaned.match(/(?:رقم\s*(?:الهوية|المدني|الوطني)|رقم\s*الحوالة|هوية\s*وطنية|الرقم\s*الوطني)\s*[:\-]?\s*(\d{10,})/i);
  if (idMatch) {
    fields.id_number = idMatch[1].slice(0, 10);
  } else {
    // Fallback: any 10-digit number starting with 1
    const fallback = cleaned.match(/\b(1\d{9})\b/);
    if (fallback) fields.id_number = fallback[1];
  }
  
  // =============================================
  // الاسم (Name)
  // =============================================
  // Multiple patterns for different OCR qualities
  const namePatterns = [
    /الاسم\s*[:\-]?\s*([^\d]{4,80}?)(?:\s+\d|\s*رقم|$)/i,
    /اسم\s*[:\-]?\s*([^\d]{4,80}?)(?:\s+\d|\s*رقم|$)/i,
    /([^\d]{4,80})\s*رقم\s*(?:الهوية|المدني)/i,
  ];
  for (const pattern of namePatterns) {
    const m = cleaned.match(pattern);
    if (m) {
      const name = m[1].replace(/\s+/g, ' ').trim();
      if (name.length > 3) {
        fields.full_name = name;
        break;
      }
    }
  }
  
  // =============================================
  // مصدرها (Issuer)
  // =============================================
  const issuerMatch = cleaned.match(/(?:مصدرها|جهة\s*الإصدار|جهة\s*الاصدار)\s*[:\-]?\s*([^\d]{4,60}?)(?:\d|$)/i);
  if (issuerMatch) fields.issuer = issuerMatch[1].trim();
  // Fallback: look for وزارة
  if (!fields.issuer) {
    const wizara = cleaned.match(/(وزارة[^\d]{3,40}?)(?:\d|$)/);
    if (wizara) fields.issuer = wizara[1].trim();
  }
  
  // =============================================
  // تاريخ الانتهاء (Expiry date) - DD/MM/YYYY or DD-MM-YYYY
  // =============================================
  const expiryPatterns = [
    /(?:تاريخ\s*(?:الانتهاء|انتهاء)|انتهاء|تاريخ\s*الانتهاء)\s*[:\-]?\s*(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/i,
    /(?:تنتهي|صالحة\s*حتى| valid)\s*[:\-]?\s*(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/i,
  ];
  for (const p of expiryPatterns) {
    const m = cleaned.match(p);
    if (m) {
      fields.expiry_date = m[1].slice(-4) + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
      // Swap if year is first
      if (parseInt(m[1]) > 31 && parseInt(m[3]) < 32) {
        fields.expiry_date = m[1].slice(-4) + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
      }
      break;
    }
  }
  
  // =============================================
  // تاريخ الميلاد (Birth date)
  // =============================================
  const birthPatterns = [
    /(?:تاريخ\s*(?:الميلاد|ميلاد|الازدياد)|الميلاد)\s*[:\-]?\s*(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/i,
    /(?:تاريخ\s*\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})/i,  // fallback: any date
  ];
  for (const p of birthPatterns) {
    const m = cleaned.match(p);
    if (m && m[1]) {
      fields.birth_date = m[1].slice(-4) + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
      break;
    }
  }
  
  // =============================================
  // تاريخ الإصدار (Issue date)
  // =============================================
  const issuePatterns = [
    /(?:تاريخ\s*(?:الإصدار|الاصدار|إصدار|اصدار)|صدر)\s*[:\-]?\s*(\d{1,4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,4})/i,
  ];
  for (const p of issuePatterns) {
    const m = cleaned.match(p);
    if (m) {
      fields.issue_date = m[1].slice(-4) + '-' + m[2].padStart(2,'0') + '-' + m[3].padStart(2,'0');
      break;
    }
  }
  
  // =============================================
  // العمر (Age)
  // =============================================
  const ageMatch = cleaned.match(/(?:العمر|عمر|السن)\s*[:\-]?\s*(\d+)\s*(?:سنة|عام)/i);
  if (ageMatch) {
    fields.age = ageMatch[1];
  } else if (fields.birth_date) {
    // Calculate from birth date
    try {
      const parts = fields.birth_date.split('-');
      const year = parseInt(parts[0]);
      if (year > 1900 && year < 2026) {
        fields.age = String(new Date().getFullYear() - year);
      }
    } catch(e) {}
  }
  
  // Clean up fields
  Object.keys(fields).forEach(k => {
    if (fields[k]) fields[k] = fields[k].trim();
  });
  
  return fields;
}

module.exports = { scanNationalId, extractFields };
