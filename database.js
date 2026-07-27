const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'dellini.db');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'public');

let db = null;

function getDB() {
  if (db) return db;
  throw new Error('Database not initialized. Call initializeDatabase() first.');
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Simple wrapper: exec(sql, params) returns { rows: [{col:val}], changes, lastInsertRowid }
// Uses ? placeholders like better-sqlite3
function exec(sql, params = []) {
  // Replace ? with actual escaped values for sql.js
  // sql.js's exec() doesn't support parameter binding, so we use prepared statements
  const stmt = db.prepare(sql);
  
  if (params.length > 0) {
    stmt.bind(params);
  }

  const result = { rows: [], changes: 0, lastInsertRowid: null };

  // Check if it's a SELECT-like query
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  if (isSelect) {
    while (stmt.step()) {
      result.rows.push(stmt.getAsObject());
    }
  } else {
    stmt.step();
    // Get metadata
    try {
      const info = db.exec("SELECT last_insert_rowid() as id, changes() as c");
      if (info.length > 0 && info[0].values.length > 0) {
        result.lastInsertRowid = info[0].values[0][0];
        result.changes = info[0].values[0][1];
      }
    } catch(e) {}
    saveDB();
  }

  stmt.free();
  return result;
}

// Shortcuts
function get(sql, ...params) {
  const r = exec(sql, params);
  return r.rows.length > 0 ? r.rows[0] : undefined;
}

function all(sql, ...params) {
  return exec(sql, params).rows;
}

function run(sql, ...params) {
  return exec(sql, params);
}

async function initializeDatabase() {
  const SQL = await initSqlJs();

  // Ensure the directory for DB_PATH exists
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  // Override db methods with our wrappers
  db.get = get;
  db.all = all;
  db.runStmt = run;
  db._rawRun = db.run.bind(db);

  // --- SCHEMA ---
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT,
      whatsapp TEXT,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('client','consultant','supervisor','admin')),
      is_active INTEGER DEFAULT 1,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT,
      description TEXT,
      icon TEXT DEFAULT 'bi-chat-dots',
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS consultants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      bio TEXT,
      experience_years INTEGER DEFAULT 0,
      credentials TEXT,
      is_verified INTEGER DEFAULT 0,
      verification_tier TEXT DEFAULT 'none' CHECK(verification_tier IN ('none','black','blue','silver','gold','platinum')),
      is_available INTEGER DEFAULT 1,
      rating REAL DEFAULT 0,
      rating_count INTEGER DEFAULT 0,
      balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS consultant_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultant_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (consultant_id) REFERENCES consultants(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
      UNIQUE(consultant_id, category_id)
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS consultations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      consultant_id INTEGER,
      category_id INTEGER NOT NULL,
      title TEXT,
      question TEXT NOT NULL,
      attachment_path TEXT,
      is_urgent INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft','pending_payment','paid','assigned','answered','closed','cancelled')),
      amount REAL DEFAULT 0,
      platform_fee REAL DEFAULT 0,
      consultant_earnings REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'unpaid' CHECK(payment_status IN ('unpaid','pending','paid','refunded')),
      payment_id TEXT,
      client_nickname TEXT,
      hide_identity INTEGER DEFAULT 0,
      rating INTEGER,
      rating_comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES users(id),
      FOREIGN KEY (consultant_id) REFERENCES consultants(id),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      sender_role TEXT NOT NULL,
      message TEXT NOT NULL,
      attachment_path TEXT,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      consultation_id INTEGER,
      type TEXT NOT NULL CHECK(type IN ('payment','fee','withdrawal','refund')),
      amount REAL NOT NULL,
      platform_fee REAL DEFAULT 0,
      consultant_share REAL DEFAULT 0,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','failed','cancelled')),
      description TEXT,
      stripe_payment_intent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (consultation_id) REFERENCES consultations(id)
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS withdrawal_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultant_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      bank_account_details TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','completed')),
      admin_note TEXT,
      processed_by INTEGER,
      processed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultant_id) REFERENCES consultants(id),
      FOREIGN KEY (processed_by) REFERENCES users(id)
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT,
      type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      related_id INTEGER,
      related_type TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db._rawRun(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDB();

  // --- Migrations for existing databases ---
  try { db._rawRun("ALTER TABLE users ADD COLUMN whatsapp TEXT"); } catch(e) {}
  try { db._rawRun("ALTER TABLE consultants ADD COLUMN verification_tier TEXT DEFAULT 'none'"); } catch(e) {}
  try { db._rawRun("ALTER TABLE users ADD COLUMN last_active DATETIME"); } catch(e) {}
  try { db._rawRun("ALTER TABLE users ADD COLUMN is_online INTEGER DEFAULT 0"); } catch(e) {}
  try { db._rawRun("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)"); } catch(e) {}
  try { db._rawRun("ALTER TABLE users ADD COLUMN avatar TEXT"); } catch(e) {}
  try { db._rawRun("ALTER TABLE users ADD COLUMN wallet_balance REAL DEFAULT 0"); } catch(e) {}
  try { db._rawRun("ALTER TABLE ads ADD COLUMN clicks INTEGER DEFAULT 0"); } catch(e) {}
  
  // Voice call support
  try { db._rawRun("ALTER TABLE consultations ADD COLUMN type TEXT DEFAULT 'text' CHECK(type IN ('text','voice'))"); } catch(e) {}
  try { db._rawRun("ALTER TABLE consultations ADD COLUMN duration_minutes INTEGER DEFAULT 0"); } catch(e) {}
  try { db._rawRun("ALTER TABLE consultations ADD COLUMN voice_call_price REAL DEFAULT 0"); } catch(e) {}
  try { db._rawRun("ALTER TABLE consultant_categories ADD COLUMN voice_enabled INTEGER DEFAULT 0"); } catch(e) {}
  try { db._rawRun("ALTER TABLE consultant_categories ADD COLUMN voice_price_per_minute REAL DEFAULT 0"); } catch(e) {}

  // Mark all verified consultants as online (checked every startup)
  try { db._rawRun("UPDATE users SET is_online = 1, last_active = datetime('now') WHERE role = 'consultant' AND id IN (SELECT user_id FROM consultants WHERE is_verified = 1)"); } catch(e) {}

  // Bank transfers table
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS bank_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      bank_name TEXT,
      sender_name TEXT,
      recipient_name TEXT,
      transfer_number TEXT,
      transfer_date TEXT,
      receipt_image TEXT,
      ocr_data TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
      admin_note TEXT,
      verified_by INTEGER,
      verified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultation_id) REFERENCES consultations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Wallets table
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Wallet transactions
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('deposit','payment','withdrawal','refund')),
      amount REAL NOT NULL,
      payment_method TEXT,
      payment_id TEXT,
      description TEXT,
      status TEXT DEFAULT 'completed' CHECK(status IN ('pending','completed','failed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
    )
  `);

  // Payment settings
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Services table (sub-services under categories)
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      name_ar TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT 'bi-bookmark-check',
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    )
  `);

  // Consultant services (many-to-many)
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS consultant_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      consultant_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      price REAL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (consultant_id) REFERENCES consultants(id) ON DELETE CASCADE,
      FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
      UNIQUE(consultant_id, service_id)
    )
  `);

  // Ads table
  db._rawRun(`
    CREATE TABLE IF NOT EXISTS ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      link_url TEXT,
      position TEXT DEFAULT 'homepage',
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅ Database initialized successfully');
  return db;
}

async function seedDatabase() {
  if (!db) await initializeDatabase();

  const existingAdmin = db.get("SELECT id FROM users WHERE email = ?", 'admin@dellini.com');
  if (existingAdmin) {
    console.log('📦 Database already seeded');
    return;
  }

  const hp = (s) => bcrypt.hashSync(s, 10);

  db.runStmt("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)",
    'مدير المنصة', 'admin@dellini.com', '0500000000', hp('admin123'), 'admin');
  db.runStmt("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)",
    'مشرف المنصة', 'supervisor@dellini.com', '0500000001', hp('admin123'), 'supervisor');
  db.runStmt("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)",
    'أحمد المستشار', 'consultant@dellini.com', '0500000002', hp('consultant123'), 'consultant');
  db.runStmt("INSERT INTO users (name, email, phone, password, role) VALUES (?, ?, ?, ?, ?)",
    'سارة العميلة', 'client@dellini.com', '0500000003', hp('client123'), 'client');

  const categories = [
    { n: 'استشارات مالية', i: 'bi-cash-coin', d: 'استشارات في التخطيط المالي والاستثمار والضرائب' },
    { n: 'استشارات أسرية', i: 'bi-heart', d: 'استشارات زوجية وأسرية وتربية الأطفال' },
    { n: 'استشارات قضائية', i: 'bi-bank', d: 'استشارات قانونية وقضائية' },
    { n: 'استشارات تقنية', i: 'bi-laptop', d: 'استشارات في التقنية والبرمجة وتطوير الأعمال الرقمية' },
    { n: 'استشارات نفسية', i: 'bi-emoji-smile', d: 'استشارات نفسية ودعم نفسي' },
  ];

  categories.forEach((c, i) => {
    db.runStmt("INSERT INTO categories (name_ar, description, icon, sort_order) VALUES (?, ?, ?, ?)",
      c.n, c.d, c.i, i + 1);
  });

  const cu = db.get("SELECT id FROM users WHERE email = ?", 'consultant@dellini.com');
  const cats = db.all("SELECT id FROM categories ORDER BY id");

  db.runStmt("INSERT INTO consultants (user_id, bio, experience_years, credentials, is_verified, verification_tier, is_available, balance) VALUES (?, ?, ?, ?, 1, 'gold', 1, 5000)",
    cu.id, 'مستشار مالي وقانوني معتمد بخبرة تزيد عن 10 سنوات في المجال', 10, 'شهادة ماجستير في المالية - عضو هيئة الخبراء');
  db.runStmt("UPDATE users SET is_online = 1, last_active = datetime('now') WHERE id = ?", cu.id);

  // Seed additional consultants
  const moreConsultants = [
    { name: 'د. نورة العنزي', email: 'nora@dellini.com', phone: '0500000010', bio: 'استشارية أسرية ونفسية معتمدة', exp: 12, cred: 'دكتوراه في علم النفس - مستشارة أسرية', tier: 'platinum', catIdx: 1, price: 250 },
    { name: 'م. محمد الحربي', email: 'mohammed@dellini.com', phone: '0500000011', bio: 'خبير تقني ومبرمج متخصص في تطوير التطبيقات', exp: 8, cred: 'ماجستير هندسة برمجيات', tier: 'blue', catIdx: 3, price: 300 },
    { name: 'أ. سعد القحطاني', email: 'saad@dellini.com', phone: '0500000012', bio: 'محامي ومستشار قضائي معتمد', exp: 15, cred: 'دكتوراه في القانون - محامي مجاز', tier: 'gold', catIdx: 2, price: 350 },
    { name: 'د. مريم الشمري', email: 'mariam@dellini.com', phone: '0500000013', bio: 'استشارية نفسية معتمدة', exp: 7, cred: 'دكتوراه في علم النفس الإكلينيكي', tier: 'silver', catIdx: 4, price: 200 },
  ];
  moreConsultants.forEach((mc, idx) => {
    db.runStmt("INSERT INTO users (name, email, phone, password, role, is_online, last_active) VALUES (?, ?, ?, ?, 'consultant', ?, ?)",
      mc.name, mc.email, mc.phone, hp('consultant123'), idx < 2 ? 1 : 0, idx < 2 ? "datetime('now')" : "datetime('now', '-' || (idx * 30) || ' minutes')");
    const newU = db.get("SELECT id FROM users WHERE email = ?", mc.email);
    db.runStmt("UPDATE users SET last_active = datetime('now', ?) WHERE id = ?", 
      idx >= 2 ? '-' + (idx * 30) + ' minutes' : '0 minutes', newU.id);
    db.runStmt("INSERT INTO consultants (user_id, bio, experience_years, credentials, is_verified, verification_tier, is_available, balance) VALUES (?, ?, ?, ?, 1, ?, 1, ?)",
      newU.id, mc.bio, mc.exp, mc.cred, mc.tier, Math.floor(Math.random() * 3000) + 1000);
    const newC = db.get("SELECT id FROM consultants WHERE user_id = ?", newU.id);
    cats.forEach((c, i) => {
      if (i === mc.catIdx) {
        db.runStmt("INSERT INTO consultant_categories (consultant_id, category_id, price) VALUES (?, ?, ?)",
          newC.id, c.id, mc.price);
      }
    });
  });

  const cr = db.get("SELECT id FROM consultants WHERE user_id = ?", cu.id);
  const prices = [200, 150, 300, 250, 180];

  cats.forEach((c, i) => {
    db.runStmt("INSERT INTO consultant_categories (consultant_id, category_id, price) VALUES (?, ?, ?)",
      cr.id, c.id, prices[i] || 200);
  });

  const cl = db.get("SELECT id FROM users WHERE email = ?", 'client@dellini.com');
  db.runStmt(`INSERT INTO consultations (client_id, consultant_id, category_id, title, question, status, amount, platform_fee, consultant_earnings, payment_status, client_nickname, hide_identity)
    VALUES (?, ?, ?, ?, ?, 'answered', 200, 50, 150, 'paid', 'مستخدم_سارة', 1)`,
    cl.id, cr.id, cats[0].id, 'استشارة حول التخطيط المالي', 'أحتاج مساعدة في وضع خطة مالية لبدء مشروع صغير...');

  const cons = db.get("SELECT id FROM consultations ORDER BY id DESC LIMIT 1");
  db.runStmt("INSERT INTO messages (consultation_id, sender_id, sender_role, message) VALUES (?, ?, ?, ?)",
    cons.id, cl.id, 'client', 'مرحباً، أريد استشارة بخصوص التخطيط المالي');
  db.runStmt("INSERT INTO messages (consultation_id, sender_id, sender_role, message) VALUES (?, ?, ?, ?)",
    cons.id, cu.id, 'consultant', 'وعليكم السلام، يسعدني مساعدتك. هل لديك ميزانية تقديرية للمشروع؟');

  // Seed sample ads
  const adColors = ['#6f42c1', '#dc3545', '#198754', '#0d6efd', '#fd7e14'];
  const sampleAds = [
    { t: 'مكتب المحامي سعد القحطاني', d: 'استشارات قانونية - محاماة - عقود - قضايا', icon: 'bi-bank', sort: 1 },
    { t: 'مكتب المحامية نورة العنزي', d: 'محاماة واستشارات أسرية - أحوال شخصية', icon: 'bi-heart', sort: 2 },
    { t: 'مستشارك المالي', d: 'خطط استثمارية - تمويل - زكاة وضرائب', icon: 'bi-cash-coin', sort: 3 },
    { t: 'التقنية بين يديك', d: 'تطوير تطبيقات - استشارات تقنية - برمجة', icon: 'bi-laptop', sort: 4 },
    { t: 'دعم نفسي مع د. مريم', d: 'استشارات نفسية - دعم نفسي - تطوير الذات', icon: 'bi-emoji-smile', sort: 5 },
  ];
  sampleAds.forEach((ad, i) => {
    db.runStmt("INSERT INTO ads (title, description, image_url, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)",
      ad.t, ad.d, adColors[i % adColors.length], '/client/new', ad.sort);
  });

  saveDB();

  console.log('🌱 Database seeded successfully');
  console.log('📧 Admin: admin@dellini.com / admin123');
  console.log('📧 Supervisor: supervisor@dellini.com / admin123');
  console.log('📧 Consultant: consultant@dellini.com / consultant123');
  console.log('📧 Client: client@dellini.com / client123');
}

module.exports = { getDB, initializeDatabase, seedDatabase, saveDB };
