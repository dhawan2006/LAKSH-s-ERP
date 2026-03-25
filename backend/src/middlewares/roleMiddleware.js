'use strict';

/**
 * Role-Based Access Control Middleware
 *
 * requireAdmin  — only users with role === 'admin' can proceed
 * requireWorker — any authenticated user (admin or worker) can proceed
 *
 * Must be used AFTER authMiddleware so req.user is populated.
 */

const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Access denied. Admin role required.' });
    }
    next();
};

const requireWorker = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!['admin', 'worker'].includes(req.user.role)) {
        return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    next();
};

module.exports = { requireAdmin, requireWorker };
