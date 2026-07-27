const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const path = require('path');

async function setup() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  
  // Create ALL tables
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT, whatsapp TEXT, password TEXT NOT NULL, role TEXT NOT NULL,
    is_active INTEGER DEFAULT 1, avatar TEXT, is_online INTEGER DEFAULT 0,
    last_active DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name_ar TEXT NOT NULL, name_en TEXT,
    description TEXT, icon TEXT DEFAULT 'bi-chat-dots', is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS consultants (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL,
    bio TEXT, experience_years INTEGER DEFAULT 0, credentials TEXT,
    is_verified INTEGER DEFAULT 0, verification_tier TEXT DEFAULT 'none',
    is_available INTEGER DEFAULT 1, rating REAL DEFAULT 0, rating_count INTEGER DEFAULT 0,
    balance REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT,
    image_url TEXT, link_url TEXT, position TEXT DEFAULT 'homepage',
    is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, clicks INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const hp = (s) => bcrypt.hashSync(s, 10);

  // Users: use ARRAY form for sql.js -> db.run(sql, [params])
  const users = [
    ['مدير المنصة', 'admin@dellini.com', hp('admin123'), 'admin'],
    ['مشرف المنصة', 'supervisor@dellini.com', hp('admin123'), 'supervisor'],
    ['أحمد المستشار', 'consultant@dellini.com', hp('consultant123'), 'consultant'],
    ['سارة العميلة', 'client@dellini.com', hp('client123'), 'client'],
    ['مدير جديد 2', 'admin2@dellini.com', hp('admin123'), 'admin'],
    ['المدير abdmmm9', 'abdmmm9@gmail.com', hp('K282312'), 'admin'],
  ];
  
  for (const u of users) {
    db.run('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)', u);
  }
  
  console.log('=== حسابات الإدارة ===');
  const stmt = db.prepare('SELECT id, email, role FROM users ORDER BY email');
  while(stmt.step()) {
    const r = stmt.getAsObject();
    if (r.role === 'admin') console.log('  👑 ' + r.email + ' (id=' + r.id + ')');
  }
  stmt.free();
  
  // Categories
  const cats = [
    ['استشارات مالية', 'استشارات في التخطيط المالي والاستثمار والضرائب', 'bi-cash-coin', 1],
    ['استشارات أسرية', 'استشارات زوجية وأسرية وتربية الأطفال', 'bi-heart', 2],
    ['استشارات قضائية', 'استشارات قانونية وقضائية', 'bi-bank', 3],
    ['استشارات تقنية', 'استشارات في التقنية والبرمجة', 'bi-laptop', 4],
    ['استشارات نفسية', 'استشارات نفسية ودعم نفسي', 'bi-emoji-smile', 5],
  ];
  for (const c of cats) {
    db.run('INSERT INTO categories (name_ar, description, icon, sort_order) VALUES (?, ?, ?, ?)', c);
  }
  
  // Sample ads
  const ads = [
    ['مكتب المحامي سعد القحطاني', 'استشارات قانونية - محاماة', '#6f42c1', 1],
    ['مكتب المحامية نورة العنزي', 'محاماة واستشارات أسرية', '#dc3545', 2],
    ['مستشارك المالي', 'خطط استثمارية - تمويل', '#198754', 3],
    ['التقنية بين يديك', 'تطوير تطبيقات - استشارات تقنية', '#0d6efd', 4],
    ['دعم نفسي مع د. مريم', 'استشارات نفسية - تطوير الذات', '#fd7e14', 5],
  ];
  for (const ad of ads) {
    db.run('INSERT INTO ads (title, description, image_url, link_url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, 1)', ad);
  }
  
  // Save to file
  const data = db.export();
  const dbPath = path.join(__dirname, 'dellini.db');
  fs.writeFileSync(dbPath, Buffer.from(data));
  const size = Buffer.from(data).length;
  console.log('✅ تم حفظ قاعدة البيانات (' + size + ' bytes)');
}

setup().catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
