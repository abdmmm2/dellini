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

// Check if user is admin or supervisor
function requireStaff(req, res, next) {
  return requireRole('admin', 'supervisor')(req, res, next);
}

// Check if user is admin only
function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
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

module.exports = { requireLogin, requireRole, requireConsultant, requireStaff, requireAdmin, loadConsultant };
