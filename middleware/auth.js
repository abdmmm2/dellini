// Require login
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.error_msg = 'يرجى تسجيل الدخول أولاً';
    return res.redirect('/login');
  }
  next();
}

// Require specific roles
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.error_msg = 'يرجى تسجيل الدخول أولاً';
      return res.redirect('/login');
    }
    if (!roles.includes(req.session.user.role)) {
      req.session.error_msg = 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
      return res.redirect('/');
    }
    next();
  };
}

// Check if user is consultant
function requireConsultant(req, res, next) {
  return requireRole('consultant')(req, res, next);
}

// Check if user is admin or supervisor (with permission check)
function requireStaff(req, res, next) {
  if (!req.session.user) {
    req.session.error_msg = 'يرجى تسجيل الدخول أولاً';
    return res.redirect('/login');
  }
  
  const role = req.session.user.role;
  if (role === 'admin') return next();
  if (role === 'supervisor') return next();
  
  req.session.error_msg = 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
  return res.redirect('/');
}

// Check if user is admin only
function requireAdmin(req, res, next) {
  if (!req.session.user) {
    req.session.error_msg = 'يرجى تسجيل الدخول أولاً';
    return res.redirect('/login');
  }
  
  if (req.session.user.role === 'admin') return next();
  
  req.session.error_msg = 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
  return res.redirect('/');
}

// 🆕 Check specific permission
function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.session.user) {
      req.session.error_msg = 'يرجى تسجيل الدخول أولاً';
      return res.redirect('/login');
    }
    
    const role = req.session.user.role;
    // Admin has all permissions
    if (role === 'admin') return next();
    
    // Load permissions from DB
    const { getDB } = require('../database');
    const db = getDB();
    const row = db.get('SELECT permissions FROM permissions WHERE role = ?', role);
    if (!row) {
      req.session.error_msg = 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
      return res.redirect('/');
    }
    
    let perms = {};
    try { perms = JSON.parse(row.permissions); } catch(e) {}
    
    if (perms[permissionKey]) return next();
    
    req.session.error_msg = 'ليس لديك صلاحية للوصول إلى هذه الصفحة';
    return res.redirect('/');
  };
}

// Get consultant profile from DB
function loadConsultant(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'consultant') return next();
  const { getDB } = require('../database');
  const db = getDB();
  const consultant = db.prepare('SELECT * FROM consultants WHERE user_id = ?').get(req.session.user.id);
  req.consultant = consultant;
  req.session.user.consultant_id = consultant?.id;
  next();
}

module.exports = { requireLogin, requireRole, requireConsultant, requireStaff, requireAdmin, requirePermission, loadConsultant };
