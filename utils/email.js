const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.ethereal.email',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

const SITE_NAME = process.env.SITE_NAME || 'دلني';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const SMTP_CONFIGURED = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

function emailTemplate(title, content) {
  return '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;background:#f0f2f5;font-family:Tajawal,Arial,sans-serif;">'
    + '<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:20px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">'
    + '<tr><td style="background:linear-gradient(135deg,#1a2332,#2a3a5c);padding:30px;text-align:center;">'
    + '<div style="width:70px;height:70px;background:#c8a45c;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px;">'
    + '<span style="color:#1a2332;font-size:32px;font-weight:900;">د</span></div>'
    + '<h1 style="color:#c8a45c;margin:5px 0;font-size:24px;">' + SITE_NAME + '</h1>'
    + '<p style="color:rgba(255,255,255,0.7);margin:0;font-size:14px;">منصة استشارات إلكترونية</p></td></tr>'
    + '<tr><td style="padding:30px;">'
    + '<h2 style="color:#1a2332;font-size:20px;margin:0 0 5px;">' + title + '</h2>'
    + '<div style="height:3px;width:50px;background:#c8a45c;margin-bottom:20px;"></div>'
    + content
    + '</td></tr>'
    + '<tr><td style="padding:20px;background:#f8f9fa;text-align:center;border-top:1px solid #eee;">'
    + '<p style="color:#999;font-size:12px;margin:0;">&copy; ' + new Date().getFullYear() + ' ' + SITE_NAME + ' — جميع الحقوق محفوظة</p>'
    + '<p style="color:#999;font-size:11px;margin:5px 0 0;">هذا البريد إلكتروني تلقائي، يرجى عدم الرد عليه.</p></td></tr>'
    + '</table></body></html>';
}

async function sendEmail(to, subject, html) {
  const fullHtml = html.includes('<!DOCTYPE') ? html : emailTemplate(subject, html);
  
  if (!SMTP_CONFIGURED) {
    console.log('\n===== EMAIL (SMTP not configured) =====');
    console.log('To:', to);
    console.log('Subject:', subject);
    const codeMatch = fullHtml.match(/\d{4,6}/);
    if (codeMatch) console.log('VERIFICATION CODE:', codeMatch[0]);
    console.log('========================================\n');
    return { success: true, simulated: true };
  }

  try {
    const info = await transporter.sendMail({
      from: '"' + SITE_NAME + '" <' + (process.env.SMTP_FROM || 'noreply@dellini.net') + '>',
      to,
      subject,
      html: fullHtml
    });
    console.log('Email sent to ' + to + ': ' + info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('Email error:', err.message);
    return { success: false, error: err.message };
  }
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendVerificationCode(email, name, code) {
  const content = '<p style="color:#555;line-height:1.8;">مرحباً <strong style="color:#1a2332;">' + name + '</strong>،</p>'
    + '<p style="color:#555;line-height:1.8;">شكراً لتسجيلك في <strong>' + SITE_NAME + '</strong>، يرجى استخدام رمز التفعيل التالي لتأكيد بريدك الإلكتروني:</p>'
    + '<div style="text-align:center;margin:25px 0;padding:20px;background:#f8f9fa;border-radius:12px;border:2px dashed #c8a45c;">'
    + '<p style="color:#666;font-size:14px;margin:0 0 10px;">رمز التفعيل</p>'
    + '<div style="font-size:42px;font-weight:900;color:#1a2332;letter-spacing:8px;direction:ltr;">' + code + '</div></div>'
    + '<p style="color:#6c757d;font-size:14px;">هذا الرمز صالح لمدة <strong>10 دقائق</strong>.</p>'
    + '<p style="color:#6c757d;font-size:14px;">إذا لم تقم بالتسجيل، يرجى تجاهل هذا الإيميل.</p>';
  return sendEmail(email, 'تفعيل البريد الإلكتروني - ' + SITE_NAME, content);
}

async function sendPasswordReset(email, name, token) {
  const link = SITE_URL + '/reset-password?token=' + token + '&email=' + encodeURIComponent(email);
  const content = '<p style="color:#555;line-height:1.8;">مرحباً <strong style="color:#1a2332;">' + name + '</strong>،</p>'
    + '<p style="color:#555;line-height:1.8;">لقد تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في ' + SITE_NAME + '.</p>'
    + '<div style="text-align:center;margin:25px 0;">'
    + '<a href="' + link + '" style="display:inline-block;padding:14px 40px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">إعادة تعيين كلمة المرور</a></div>'
    + '<p style="color:#6c757d;font-size:14px;">الرابط صالح لمدة ساعة واحدة.</p>'
    + '<p style="color:#6c757d;font-size:14px;">إذا لم تطلب ذلك، تجاهل هذا الإيميل.</p>';
  return sendEmail(email, 'إعادة تعيين كلمة المرور - ' + SITE_NAME, content);
}

async function sendWelcomeEmail(email, name) {
  const content = '<p style="color:#555;line-height:1.8;">مرحباً <strong style="color:#1a2332;">' + name + '</strong>،</p>'
    + '<p style="color:#555;line-height:1.8;">تم إنشاء حسابك بنجاح في <strong>' + SITE_NAME + '</strong></p>'
    + '<p style="color:#555;line-height:1.8;">يمكنك الآن الاستفادة من خدمات المنصة حسب نوع حسابك.</p>'
    + '<div style="text-align:center;margin:20px 0;">'
    + '<a href="' + SITE_URL + '" style="display:inline-block;padding:12px 30px;background:#198754;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;">زيارة المنصة</a></div>';
  return sendEmail(email, 'مرحباً بك في ' + SITE_NAME, content);
}

async function sendNewConsultationNotification(email, name, consultId) {
  const link = SITE_URL + '/consultant/consultation/' + consultId;
  const content = '<p style="color:#555;line-height:1.8;">مرحباً <strong style="color:#1a2332;">' + name + '</strong>،</p>'
    + '<p style="color:#555;line-height:1.8;">لديك استشارة جديدة بانتظار ردك</p>'
    + '<div style="text-align:center;margin:20px 0;">'
    + '<a href="' + link + '" style="display:inline-block;padding:12px 30px;background:#0d6efd;color:#fff;text-decoration:none;border-radius:8px;">عرض الاستشارة</a></div>';
  return sendEmail(email, 'استشارة جديدة - ' + SITE_NAME, content);
}

async function sendReplyNotification(email, name, consultId) {
  const link = SITE_URL + '/client/consultation/' + consultId;
  const content = '<p style="color:#555;line-height:1.8;">مرحباً <strong style="color:#1a2332;">' + name + '</strong>،</p>'
    + '<p style="color:#555;line-height:1.8;">قام المستشار بالرد على استشارتك</p>'
    + '<div style="text-align:center;margin:20px 0;">'
    + '<a href="' + link + '" style="display:inline-block;padding:12px 30px;background:#198754;color:#fff;text-decoration:none;border-radius:8px;">عرض الرد</a></div>';
  return sendEmail(email, 'تم الرد على استشارتك - ' + SITE_NAME, content);
}

module.exports = { 
  sendEmail, sendVerificationCode, generateCode, sendPasswordReset, 
  sendNewConsultationNotification, sendReplyNotification, sendWelcomeEmail 
};
