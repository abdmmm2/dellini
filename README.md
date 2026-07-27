# منصة دلني للاستشارات

## 🚀 النشر على Fly.io

### المتطلبات

1. **حساب Fly.io** — سجل في [fly.io](https://fly.io)
2. **GitHub Repository** — ارفع الكود على GitHub
3. **Fly CLI** — نصب الـ CLI عشان ترفع الموقع

### الخطوات بالتفصيل

#### 1. تحميل Fly CLI

```bash
# MacOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```

#### 2. تسجيل الدخول

```bash
fly auth login
```

#### 3. إنشاء التطبيق (من مجلد المشروع)

```bash
cd dellini
fly launch --copy-config --no-deploy
```

اختر اسم للتطبيق (مثلاً `dellini-app`).

#### 4. إنشاء Volume للتخزين الدائم

```
fly volumes create dellini_data --region iad --size 1
```

هذا يخلي الصور المرفوعة وقاعدة البيانات تبقى حتى لو أعدت النشر.

#### 5. تعديل SESSION_SECRET (اختياري)

ولكن ننصحك تغيره — افتح `fly.toml` وعدل قيمة `SESSION_SECRET` إلى نص عشوائي طويل.

#### 6. نشر التطبيق

```bash
fly deploy
```

#### 7. فتح التطبيق

```bash
fly open
```

### بعد النشر — تسجيل الدخول

| الحساب | البريد الإلكتروني | كلمة المرور |
|--------|----------|----------|
| مدير | admin@dellini.com | admin123 |
| مشرف | supervisor@dellini.com | admin123 |
| مستشار | consultant@dellini.com | consultant123 |
| عميل | client@dellini.com | client123 |

> ⚠️ **تنبيه**: بعد النشر غير كلمة مرور المسؤول فوراً من لوحة التحكم.

### تحديث التطبيق

كل ما تبي تحدث الكود:

```bash
git push           # ادفع للتحديثات على GitHub
fly deploy         # Fly.io يسحب أحدث كود وينشره
```

### سحبه إذا ما عجبك

```bash
fly apps destroy dellini-app
```

---

## 🛠 التطوير محلياً

```bash
# تثبيت الحزم
npm install

# تشغيل مع بذور البيانات (أول مرة)
SEED=true node server.js

# أو بدون بذور
node server.js
```

يفتح على `http://localhost:3000`
