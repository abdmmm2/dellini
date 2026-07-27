# 🚀 نشر منصة دلني على Render

## 📋 قبل البدء
- حساب **GitHub** → [github.com/signup](https://github.com/signup)
- حساب **Render** → [render.com/register](https://render.com/register) (سجل باستخدام GitHub)
- بطاقة ائتمان لإضافة خطة **Starter ($7/شهر)**

---

## 🅰 أول 3 دقايق: ارفع الكود على GitHub

```bash
cd dellini

# لا تنسى تمسح local database من git
echo "dellini.db" >> .gitignore

git init
git add .
git commit -m "🚀 دلني - منصة استشارات"
```

> أنشئ مستودع جديد على GitHub:
> https://github.com/new → اسمه `dellini`
>
> ثم ارجع للـ terminal:
```bash
git remote add origin https://github.com/your-username/dellini.git
git push -u origin main
```

---

## 🅱 بعدين: أنشئ Web Service على Render

1. افتح [dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Web Service**
3. صل حساب GitHub → اختار مستودع `dellini`
4. املأ الحقول:

| الحقل | القيمة |
|-------|--------|
| **Name** | `dellini` |
| **Region** | الأقرب لك (مثلاً Frankfurt) |
| **Branch** | `main` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node server.js` |
| **Plan** | **Starter ($7/month)** ← عشان السيرفر ما ينام 🚀 |

### 5. أضف Persistent Disk (مهم جدًا عشان قاعدة البيانات ما تروح)
- تحت **Disks** → **Add Disk**
- **Name:** `dellini-data`
- **Mount Path:** `/data`
- **Size:** 1 GB ($0.25/شهر فقط)

### 6. أضف Environment Variables

| المتغير | القيمة |
|---------|--------|
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | أي كلمة عشوائية طويلة |
| `SITE_NAME` | `دلني` |
| `SITE_URL` | رابط Render (بيظهر فوق) |
| `DB_PATH` | `/data/dellini.db` ← يخزن قاعدة البيانات بالقرص الدائم 💾 |
| `UPLOADS_DIR` | `/data` ← الصور تثبت بعد النشر |
| `SEED` | `true` — أول تشغيل فقط عشان البذور |

### 7. اضغط **Create Web Service** 🚀

بعد 2-3 دقايق: المنصة على `https://dellini.onrender.com` 🎉

---

## 🗑️ بعد أول تشغيل: امسح SEED

1. اذهب لـ Dashboard → Environment
2. احذف `SEED` أو غيّره لـ `false`
3. إذا ما سويتها، كل ما تعيد نشر يرجع يزرع البيانات من الصفر!

---

## 🔐 حسابات الاختبار (بعد الـ Seed)

| الدور | البريد | كلمة السر |
|-------|--------|-----------|
| 👑 أدمن | `admin@dellini.com` | `admin123` |
| 👤 عميل | `client@dellini.com` | `client123` |
| 💼 مستشار | `consultant@dellini.com` | `consultant123` |
| 🛡 مشرف | `supervisor@dellini.com` | `admin123` |

> ⚠️ أول ما تدخل، **غير كلمة سر الأدمن** من لوحة التحكم.

---

## 🔄 تحديث التطبيق

كل ما تبي تحدث الكود:

```bash
git add .
git commit -m "تحديث جديد"
git push
```

Render يسحب أحدث كود وينشره تلقائيًا ✅  
**البيانات ثابتة** لأن قاعدة البيانات على Persistent Disk 🎯

---

## 💰 التكلفة الشهرية

| الخدمة | السعر |
|-------|-------|
| Web Service Starter | $7.00 |
| Persistent Disk 1GB | $0.25 |
| **المجموع** | **$7.25/شهر ≈ 27 ريال** 🏆 |
