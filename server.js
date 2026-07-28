require('dotenv').config();
const express = require('express');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initializeDatabase, seedDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (Render, Railway, Fly.io)
app.set('trust proxy', 1);

// 🔒 Security Headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled to allow inline styles/scripts from Bootstrap
  crossOriginEmbedderPolicy: false
}));

// 🔒 Rate Limiting: Login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts
  message: { error: 'محاولات كثيرة جداً، حاول بعد 15 دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/login', loginLimiter);

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});
app.get('/healthz', (req, res) => {
  res.status(200).send('OK');
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Middleware
// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// If using persistent volume (Fly.io), also serve uploads from there
if (process.env.UPLOADS_DIR) {
  app.use('/uploads', express.static(path.join(process.env.UPLOADS_DIR, 'uploads')));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 🔒 Session (secure for production)
app.use(session({
  secret: process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? require('crypto').randomBytes(32).toString('hex') : 'dellini-dev-secret'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Global template variables
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.siteName = process.env.SITE_NAME || 'دلني';
  res.locals.currentPath = req.path;
  res.locals.success_msg = req.session.success_msg || '';
  res.locals.error_msg = req.session.error_msg || '';
  res.locals.isAdmin = req.session.user?.role === 'admin';
  res.locals.isSupervisor = req.session.user?.role === 'supervisor';
  delete req.session.success_msg;
  delete req.session.error_msg;
  next();
});

// Routes
app.use('/', require('./routes/auth'));
app.use('/client', require('./routes/client'));
app.use('/consultant', require('./routes/consultant'));
app.use('/admin', require('./routes/admin'));
app.use('/messages', require('./routes/messages'));
app.use('/', require('./routes/main'));
app.use('/', require('./routes/password-reset'));
app.use('/stripe', require('./routes/stripe'));
app.use('/stcpay', require('./routes/stcpay'));
app.use('/admin/ads', require('./routes/ads'));
app.use('/bank-transfer', require('./routes/bank-transfer'));
app.use('/call', require('./routes/call'));

// 404
app.use((req, res) => {
  res.status(404).render('404', { title: 'الصفحة غير موجودة' });
});

// Wait for DB init then start
async function startServer() {
  try {
    await initializeDatabase();
    // Auto-seed if SEED env is set, or if database is newly created (empty)
    if (process.env.SEED === 'true' || process.env.SEED === '1') {
      await seedDatabase();
    } else {
      // Check if database has data, seed if empty
      const { getDB } = require('./database');
      const db = getDB();
      const userCount = db.get('SELECT COUNT(*) as c FROM users');
      if (!userCount || userCount.c === 0) {
        console.log('🌱 Database is empty, auto-seeding...');
        await seedDatabase();
      }
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 دلني running on http://0.0.0.0:${PORT}`);
    });

    // Auto-backup once a day
    const BACKUP_DIR = process.env.BACKUP_DIR || process.env.UPLOADS_DIR || path.join(__dirname, 'public');
    const backupsPath = path.join(BACKUP_DIR, 'backups');
    try {
      if (!fs.existsSync(backupsPath)) fs.mkdirSync(backupsPath, { recursive: true });
    } catch(e) {}
    
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dellini.db');
    
    async function autoBackup() {
      try {
        if (!fs.existsSync(DB_PATH)) return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const backupName = `dellini-auto-backup-${timestamp}.db`;
        fs.copyFileSync(DB_PATH, path.join(backupsPath, backupName));
        console.log(`💾 Auto-backup: ${backupName}`);
        
        // Keep only last 7 backups
        const files = fs.readdirSync(backupsPath)
          .filter(f => f.startsWith('dellini-auto-backup'))
          .sort()
          .reverse();
        files.slice(7).forEach(f => {
          try { fs.unlinkSync(path.join(backupsPath, f)); } catch(e) {}
        });
      } catch(e) {}
    }
    
    // First backup after 1 minute
    setTimeout(autoBackup, 60000);
    // Then every 24 hours
    setInterval(autoBackup, 24 * 60 * 60 * 1000);
  } catch (err) {
    console.error('Failed to start:', err);
    // Don't exit on Railway — let health check fail and restart
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`⚠️ دلني running in degraded mode on http://0.0.0.0:${PORT}`);
    });
  }
}

startServer();
