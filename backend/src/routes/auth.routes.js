'use strict';

/**
 * Auth & Admin Routes
 *
 * POST /api/auth/login           — public (no auth required)
 * GET  /api/employees            — admin only: list all users
 * GET  /api/activity-logs        — admin only: last 200 log entries
 * POST /api/auth/change-password — admin only: reset a user password
 */

const express = require('express');
const router = express.Router();
const authCtrl = require('../controllers/auth.controller');
const authMiddleware = require('../middlewares/authMiddleware');
const { requireAdmin } = require('../middlewares/roleMiddleware');
const db = require('../config/database');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const validate = require('../middlewares/validate');
const { loginOptions, changePasswordOptions, changeMyPasswordOptions, createUserOptions } = require('../validators/auth.validator');
const apiResponse = require('../utils/apiResponse');

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 attempts per IP
    message: { success: false, message: 'Too many login attempts, please try again later.' }
});

/* ── Login ───────────────────────────────────────────────────────── */
router.post('/auth/login', loginLimiter, validate(loginOptions), authCtrl.login);

/* ── Employees (admin only) ──────────────────────────────────────── */
router.get('/employees', authMiddleware, requireAdmin, (req, res) => {
    db.all(
        `SELECT id, name, username, role, created_at FROM users ORDER BY id ASC`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch employees.', err, 500);
            return apiResponse.success(res, 'Employees fetched successfully', rows);
        }
    );
});

/* ── Activity Logs (admin only) ──────────────────────────────────── */
router.get('/activity-logs', authMiddleware, requireAdmin, (req, res) => {
    db.all(
        `SELECT al.id, al.action, al.details, al.created_at,
                COALESCE(u.name, 'System') AS user_name,
                COALESCE(u.role, '') AS user_role
         FROM   activity_logs al
         LEFT   JOIN users u ON u.id = al.user_id
         ORDER  BY al.id DESC
         LIMIT  200`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch logs.', err, 500);
            return apiResponse.success(res, 'Logs fetched successfully', rows);
        }
    );
});

/* ── Change User Password (admin only) ───────────────────────────── */
router.post('/auth/change-password', authMiddleware, requireAdmin, validate(changePasswordOptions), async (req, res) => {
    const { userId, newPassword } = req.body;
    try {
        const hash = await bcrypt.hash(newPassword, 12);
        db.run(`UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?`, [hash, userId], function (err) {
            if (err) return apiResponse.error(res, 'Failed to update password.', err, 500);
            if (this.changes === 0) return apiResponse.error(res, 'User not found.', null, 404);
            return apiResponse.success(res, 'Password updated successfully.');
        });
    } catch (e) {
        return apiResponse.error(res, 'Hashing error.', e, 500);
    }
});

/* ── Change My Password (any logged in user) ─────────────────────── */
router.post('/auth/change-my-password', authMiddleware, validate(changeMyPasswordOptions), authCtrl.changeMyPassword);

/* ── Public User List (for account-select screen) ───────────── */
router.get('/users/list', (req, res) => {
    db.all(
        `SELECT id, name, username, role FROM users ORDER BY role DESC, id ASC`,
        [],
        (err, rows) => {
            if (err) return apiResponse.error(res, 'Failed to fetch users.', err, 500);
            return apiResponse.success(res, 'Users fetched successfully', rows);
        }
    );
});

/* ── Create Worker (admin only) ──────────────────────────────── */
router.post('/users/create', authMiddleware, requireAdmin, validate(createUserOptions), async (req, res) => {
    const { name, username, password, role } = req.body;
    try {
        const hash = await bcrypt.hash(password, 12);
        db.run(
            `INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)`,
            [name, username, hash, role],
            function (err) {
                if (err) {
                    if (err.message && err.message.includes('UNIQUE')) {
                        return apiResponse.error(res, 'Username already exists.', null, 409);
                    }
                    return apiResponse.error(res, 'Failed to create user.', err, 500);
                }
                return apiResponse.success(res, 'User created successfully.', { id: this.lastID }, 201);
            }
        );
    } catch (e) {
        return apiResponse.error(res, 'Hashing error.', e, 500);
    }
});

module.exports = router;
