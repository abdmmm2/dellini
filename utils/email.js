// Email utility for دلني
// In production, configure SMTP settings in .env
// For now, it logs to console so you can see the flow

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

async function sendEmail(to, subject, html) {
  const mailOptions = {
    from: `"${SITE_NAME}" <${process.env.SMTP_FROM || 'noreply@dellini.com'}>`,
    to,
    subject,
    html
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.log(`📧 Email log (SMTP not configured): To=${to}, Subject=${subject}`);
    console.log(`   HTML preview: ${html.substring(0, 100)}...`);
    // Don't fail — just log in dev mode
    return { success: true, simulated: true };
  }
}

async function sendPasswordReset(email, token) {
  const resetLink = `${SITE_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  const html = `
    <div style="font-family: 'Tajawal', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f8f9fa; border-radius: 12px;">
      <div style="text-align: center; padding: 20px; background: #0d6efd; color: white; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">🔑 ${SITE_NAME}</h1>
        <p style="margin: 5px 0 0; opacity: 0.9;">إعادة تعيين كلمة المرور</p>
      </div>
      <div style="padding: 30px; background: white; border-radius: 0 0 12px 12px;">
        <p>مرحباً،</p>
        <p>لقد تلقينا طلباً لإعادة تعيين كلمة المرور لحسابك في ${SITE_NAME}.</p>
        <p>لإكمال العملية، يرجى الضغط على الرابط التالي:</p>
        <div style="text-align: center; margin: 25px 0;">
          <a href="${resetLink}" 
             style="display: inline-block; padding: 12px 30px; background: #0d6efd; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
            إعادة تعيين كلمة المرور
          </a>
        </div>
        <p style="color: #6c757d; font-size: 14px;">هذا الرابط صالح لمدة ساعة واحدة فقط.</p>
        <p style="color: #6c757d; font-size: 14px;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذا الإيميل.</p>
        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
        <p style="color: #6c757d; font-size: 12px; text-align: center;">
          © ${new Date().getFullYear()} ${SITE_NAME} — جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  `;
  return sendEmail(email, `إعادة تعيين كلمة المرور - ${SITE_NAME}`, html);
}

async function sendNewConsultationNotification(email, name, consultId) {
  const link = `${SITE_URL}/consultant/consultation/${consultId}`;
  const html = `
    <div style="font-family: 'Tajawal', Arial; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #0d6efd;">📩 استشارة جديدة</h2>
      <p>مرحباً ${name}،</p>
      <p>لديك استشارة جديدة بانتظار ردك على المنصة.</p>
      <a href="${link}" style="display:inline-block;padding:10px 24px;background:#0d6efd;color:white;text-decoration:none;border-radius:8px;">عرض الاستشارة</a>
    </div>
  `;
  return sendEmail(email, `استشارة جديدة - ${SITE_NAME}`, html);
}

async function sendReplyNotification(email, name, consultId) {
  const link = `${SITE_URL}/client/consultation/${consultId}`;
  const html = `
    <div style="font-family: 'Tajawal', Arial; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #0d6efd;">💬 تم الرد على استشارتك</h2>
      <p>مرحباً ${name}،</p>
      <p>قام المستشار بالرد على استشارتك. تفقد الرد الآن.</p>
      <a href="${link}" style="display:inline-block;padding:10px 24px;background:#0d6efd;color:white;text-decoration:none;border-radius:8px;">عرض الرد</a>
    </div>
  `;
  return sendEmail(email, `تم الرد على استشارتك - ${SITE_NAME}`, html);
}

async function sendWelcomeEmail(email, name) {
  const html = `
    <div style="font-family: 'Tajawal', Arial; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #0d6efd;">🎉 مرحباً بك في ${SITE_NAME}</h2>
      <p>مرحباً ${name}،</p>
      <p>تم إنشاء حسابك بنجاح في منصة ${SITE_NAME}.</p>
      <p>يمكنك الآن البدء بطلب الاستشارات أو تقديمها حسب نوع حسابك.</p>
      <a href="${SITE_URL}" style="display:inline-block;padding:10px 24px;background:#0d6efd;color:white;text-decoration:none;border-radius:8px;">زيارة المنصة</a>
    </div>
  `;
  return sendEmail(email, `مرحباً بك في ${SITE_NAME}`, html);
}

module.exports = { sendPasswordReset, sendNewConsultationNotification, sendReplyNotification, sendWelcomeEmail };
