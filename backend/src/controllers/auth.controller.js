'use strict';

/**
 * Auth Controller
 * POST /api/auth/login — validates credentials and returns a signed JWT
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const env = require('../config/env');
const apiResponse = require('../utils/apiResponse');

async function login(req, res, next) {
    try {
        const { username, password } = req.body; // Guaranteed present by Joi validation

        // Fetch user from DB
        db.get(
            `SELECT id, name, username, password_hash, role, must_change_password FROM users WHERE username = ?`,
            [username], // Username lowercased and trimmed by Joi
            async (err, user) => {
                if (err) {
                    return apiResponse.error(res, 'Database error.', err, 500);
                }

                if (!user) {
                    return apiResponse.error(res, 'Invalid username or password.', null, 401);
                }

                // Compare with bcrypt
                const match = await bcrypt.compare(password, user.password_hash);
                if (!match) {
                    return apiResponse.error(res, 'Invalid username or password.', null, 401);
                }

                // Sign JWT
                const token = jwt.sign(
                    { id: user.id, name: user.name, username: user.username, role: user.role },
                    env.JWT_SECRET,
                    { expiresIn: env.JWT_EXPIRES_IN }
                );

                return apiResponse.success(res, 'Login successful', {
                    token,
                    role: user.role,
                    name: user.name,
                    id: user.id,
                    must_change_password: user.must_change_password
                });
            }
        );
    } catch (err) {
        next(err);
    }
}

async function changeMyPassword(req, res, next) {
    try {
        const userId = req.user.id; // from authMiddleware
        const { oldPassword, newPassword } = req.body;

        db.get(`SELECT password_hash FROM users WHERE id = ?`, [userId], async (err, user) => {
            if (err) return apiResponse.error(res, 'Database error.', err, 500);
            if (!user) return apiResponse.error(res, 'User not found.', null, 404);

            const match = await bcrypt.compare(oldPassword, user.password_hash);
            if (!match) return apiResponse.error(res, 'Incorrect current password.', null, 401);

            const hash = await bcrypt.hash(newPassword, 12);
            db.run(
                `UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`,
                [hash, userId],
                function (err2) {
                    if (err2) return apiResponse.error(res, 'Failed to update password.', err2, 500);
                    return apiResponse.success(res, 'Password updated successfully.');
                }
            );
        });
    } catch (err) {
        next(err);
    }
}

module.exports = { login, changeMyPassword };
