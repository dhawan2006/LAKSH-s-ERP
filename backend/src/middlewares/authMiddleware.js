'use strict';

/**
 * JWT Authentication Middleware
 * Verifies Bearer token and attaches req.user = { id, name, username, role }
 *
 * Routes that DON'T need auth (e.g. /api/v1/auth/login) bypass this middleware
 * by being mounted BEFORE this middleware in server.js — no path checking needed.
 */

const jwt = require('jsonwebtoken');
const env = require('../config/env');

module.exports = function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        req.user = {
            id: decoded.id,
            name: decoded.name,
            username: decoded.username,
            role: decoded.role,
        };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token. Please log in again.' });
    }
};
