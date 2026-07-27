# 🚀 نشر منصة دلني على الإنترنت (مجاني)

## 📋 متطلبات سريعة
- حساب **GitHub** ← https://github.com/signup
- حساب **Render** ← https://render.com/register (سجل باستخدام GitHub)

---

## ⚡ الطريقة 1: Render (أسهل — دقيقة وحدة)

### 1️⃣ ارفع الكود على GitHub
```
cd delini
git init
git add .
git commit -m "دلني - منصة استشارات"
```
> أنشئ مستودع جديد على GitHub → `https://github.com/your-username/dellini`
> ورجّع للـ terminal:
```
git remote add origin https://github.com/your-username/dellini.git
git push -u origin main
```

### 2️⃣ أنشئ Web Service على Render
- افتح **dashboard.render.com** → **New +** → **Web Service**
- صلّ حساب GitHub → اختار مستودع `dellini`
- املأ الحقول كذا:

| الحقل | القيمة |
|-------|--------|
| **Name** | `dellini` |
| **Region** | `Frankfurt (EU)` |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | **Free** 💚 |

### 3️⃣ أضف المتغيرات البيئية (Environment Variables)

| المتغير | القيمة |
|---------|--------|
| `PORT` | `3000` |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | أي كلمة عشوائية |
| `SITE_NAME` | `دلني` |
| `SITE_URL` | رابط Render (بيظهر فوق) |
| `STRIPE_SECRET_KEY` | (اتركه أو حط `sk_test_placeholder`) |
| `SEED` | `true` — فقط لأول تشغيل عشان البذور |

### 4️⃣ اضغط **Create Web Service** 🚀

**بعد 2-3 دقايق:** المنصة شغالة على `https://dellini.onrender.com` 🎉

---

## ⚡ الطريقة 2: Railway (بديل سريع)

1. افتح **railway.app** → **New Project** → **Deploy from GitHub repo**
2. اختار مستودع `dellini`
3. أضف المتغيرات البيئية (نفس اللي فوق)
4. Railway يشتغل على طول

---

## 🔐 حسابات الاختبار بعد النشر

| الدور | البريد | كلمة السر |
|-------|--------|-----------|
| 👑 أدمن | `admin@dellini.com` | `admin123` |
| 👤 عميل | `client@dellini.com` | `client123` |
| 💼 مستشار | `consultant@dellini.com` | `consultant123` |
| 🛡 مشرف | `supervisor@dellini.com` | `admin123` |

---

## 📝 ملاحظات مهمة

1. **أول تشغيل فقط:** حط `SEED=true` عشان تنزرع البذور (حسابات الاختبار + التصنيفات). بعد أول تشغيل، احذف المتغير أو غيّره لـ `false`
2. **التخزين:** المنصة تستخدم SQLite. Render المجاني يستخدم disk ephemeral — يعني البيانات تمسح مع كل deploy جديد. للاستخدام الإنتاجي الفعلي، ركّب PostgreSQL.
3. **STC Pay:** افتراضياً شغال في وضع المحاكاة. عشان تفعّله حقيقي، أضف:
   - `STCPAY_MERCHANT_ID`
   - `STCPAY_API_KEY`
   - `STCPAY_SECRET_KEY`
   - `STCPAY_MODE=live`
4. **Stripe:** عشان الدفع ببطاقة ائتمانية فعلي، حط `STRIPE_SECRET_KEY` الحقيقي

---

## 🧹 بعد النشر
- امسح `SEED=true` من Environment Variables
- غيّر `SESSION_SECRET` لكلمة قوية
- حدّث `SITE_URL` عشان الروابط تشتغل صح
- جرب الدخول بالحسابات فوق

---

**مبروك! دلني على الإنترنت 🎉**
